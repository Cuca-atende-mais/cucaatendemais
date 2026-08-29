import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";
import * as Sentry from "@sentry/nextjs";
import heicDecode from "heic-decode";
import { encode as encodeJpeg } from "jpeg-js";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Assinaturas de Magic Bytes por formato
const MAGIC_SIGNATURES: Array<{ bytes: number[]; mime: string; ext: string }> = [
  { bytes: [0x25, 0x50, 0x44, 0x46],             mime: "application/pdf",      ext: "pdf" }, // %PDF
  { bytes: [0xff, 0xd8, 0xff],                    mime: "image/jpeg",           ext: "jpg" }, // JPEG
  { bytes: [0x89, 0x50, 0x4e, 0x47],             mime: "image/png",            ext: "png" }, // PNG
  { bytes: [0x50, 0x4b, 0x03, 0x04],             mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" }, // PK (ZIP → DOCX)
  { bytes: [0xd0, 0xcf, 0x11, 0xe0],             mime: "application/msword",   ext: "doc" }, // DOC (OLE2)
];

const ALLOWED_MIMES = new Set(MAGIC_SIGNATURES.map((s) => s.mime));

function detectMagicBytes(buf: Buffer): typeof MAGIC_SIGNATURES[0] | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return sig;
  }
  return null;
}

// S-EMP-AUD-035: HEIC/HEIF (formato padrão de foto do iPhone desde o iOS 11, 2017) não tem uma
// assinatura de 4 bytes fixa no início do arquivo como os formatos de MAGIC_SIGNATURES — é uma
// caixa ISOBMFF "ftyp" no offset 4-7, com o "brand" (formato real) no offset 8-11. Detecta só os
// brands HEIC/HEIF conhecidos — não confunde com outros formatos baseados em ftyp (ex. MP4/MOV,
// que usam brands diferentes como "isom"/"qt  ") e continuam rejeitados normalmente.
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);

function isHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  return HEIC_BRANDS.has(buf.subarray(8, 12).toString("ascii").trim().toLowerCase());
}

// S-EMP-AUD-035 (achado @qa, review): a conversão de HEIC decodifica a imagem inteira DENTRO
// deste processo (heic-decode/libheif-js, WASM) — diferente de JPEG/PNG, que nunca são
// decodificados nesta rota (só os primeiros bytes são lidos). Sem limite, um HEIC malicioso
// dentro do teto de 10MB de upload, mas com dimensões desproporcionais ao tamanho comprimido
// (compressão HEVC é muito eficiente), poderia forçar a alocação de um buffer de pixels gigante
// em memória ("image bomb") — e esta rota não tem rate limit. `heic-decode.all()` expõe
// width/height ANTES de decodificar os pixels de fato (só lê o cabeçalho do container HEIF,
// barato) — o limite é checado nesse ponto, antes da parte cara.
const HEIC_MAX_LADO_PX = 10_000; // maior que qualquer foto/panorama real de celular
const HEIC_MAX_MEGAPIXELS = 40_000_000; // ~160MB de buffer RGBA no pior caso (40MP * 4 bytes)
const HEIC_TIMEOUT_MS = 15_000;

// @types/heic-decode não declara width/height em `.all()` (gap da definição — a lib real expõe,
// ver heic-decode/lib.js: `{ width, height, decode }`), então tipamos aqui pra refletir a forma
// real do objeto sem recorrer a `any`. `.all()` também devolve uma `dispose()` no array inteiro
// (propriedade não-enumerable, por isso fácil de esquecer) — diferente de `.one()`, que libera o
// decoder WASM sozinho, `.all()` deixa isso por conta de quem chama (achado @qa, v0.6: sem
// chamar, cada conversão vazava o decoder e os handles de imagem).
interface HeicImagensDecodiveis extends Array<HeicImagemDecodivel> {
  dispose?: () => void;
}
interface HeicImagemDecodivel {
  width: number;
  height: number;
  decode(): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}

// Achado @qa v0.6: o timer perdedor da corrida nunca era limpo — mesmo com a promessa principal
// resolvendo primeiro, o `setTimeout` ficava pendurado até disparar sozinho (rejeitando uma
// `Promise.race` já resolvida, inofensivo, mas ainda um timer vivo por até `ms` a cada chamada).
function comTimeout<T>(promessa: Promise<T>, ms: number, mensagem: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(mensagem)), ms);
  });
  return Promise.race([promessa, timeout]).finally(() => clearTimeout(timer));
}

async function converterHeicParaJpeg(buffer: Buffer, quality: number): Promise<Buffer> {
  const imagens = (await comTimeout(
    heicDecode.all({ buffer: new Uint8Array(buffer) }),
    HEIC_TIMEOUT_MS,
    "Timeout ao ler o cabeçalho do HEIC.",
  )) as unknown as HeicImagensDecodiveis;

  // Achado @qa v0.6 (crítico): `.all()` não libera o decoder WASM sozinho como `.one()` fazia —
  // precisa chamar `.dispose()` manualmente, nos dois caminhos (sucesso e erro), senão todo HEIC
  // convertido com sucesso vaza memória do processo. Não cobre o caso de timeout NESTA promessa
  // (`heicDecode.all()` nunca chegou a resolver, não há `imagens` pra dispor — limitação inerente
  // de implementar timeout sem AbortController real, que a lib não oferece).
  try {
    if (!imagens.length) {
      throw new Error("HEIC sem nenhuma imagem decodificável.");
    }
    const primeira = imagens[0];

    if (
      primeira.width > HEIC_MAX_LADO_PX ||
      primeira.height > HEIC_MAX_LADO_PX ||
      primeira.width * primeira.height > HEIC_MAX_MEGAPIXELS
    ) {
      throw new Error(
        `HEIC com dimensões acima do limite seguro (${primeira.width}x${primeira.height}).`
      );
    }

    const decodificada = await comTimeout(
      primeira.decode(),
      HEIC_TIMEOUT_MS,
      "Timeout ao decodificar os pixels do HEIC.",
    );

    // Mesma fórmula de quality que o heic-convert usa internamente (formats-node.js:
    // `Math.floor(quality * 100)`) — mantém a saída equivalente à lib anterior, só com o gate de
    // dimensão no meio.
    const jpeg = encodeJpeg(
      { data: decodificada.data, width: decodificada.width, height: decodificada.height },
      Math.floor(quality * 100),
    ).data;

    // S-EMP-AUD-035 (achado @qa, review): HEIC comprime melhor que JPEG — um HEIC de 9MB (dentro
    // do teto de upload) pode virar um JPEG bem maior. Reaplica o mesmo MAX_SIZE_BYTES que já
    // vale pro arquivo original, agora sobre o resultado convertido.
    if (jpeg.length > MAX_SIZE_BYTES) {
      throw new Error(
        `JPEG convertido do HEIC excede o limite de ${MAX_SIZE_BYTES / (1024 * 1024)}MB.`
      );
    }

    return jpeg;
  } finally {
    imagens.dispose?.();
  }
}

// S-EMP-AUD-034: só os primeiros bytes (nunca o arquivo inteiro — pode conter dado pessoal
// sensível) — é o dado que faltou pra confirmar/descartar a hipótese HEIC da auditoria
// (AUDITORIA-empregabilidade-2026-08-27, BUG-03) e vai resolver a próxima hipótese parecida
// sem depender de sorte com uma conversa ao vivo.
function primeirosBytesHex(buf: Buffer, n = 12): string {
  return buf.subarray(0, n).toString("hex");
}

// S-EMP-AUD-034 (achado @qa): nome de arquivo de currículo costuma carregar o nome real do
// candidato (ex. "curriculo_joao_silva.pdf") — dado pessoal. Loga só a extensão, que é o que
// importa pra diagnosticar formato, sem mandar o nome completo pro Sentry/log de servidor.
function extensaoArquivo(nome: string | null | undefined): string {
  if (!nome) return "sem_nome";
  const partes = nome.split(".");
  return partes.length > 1 ? partes[partes.length - 1].toLowerCase() : "sem_extensao";
}

export async function POST(req: NextRequest) {
  // Declarado fora do try pra ficar disponível no catch (contexto do Sentry, S-EMP-AUD-034) —
  // sem isso o folder (carrega o vagaId embutido) some justamente quando mais precisamos dele.
  let folder: string | undefined;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    folder = (formData.get("folder") as string) || "candidaturas";

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
    }

    // 1. Tamanho máximo
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "Arquivo excede o limite de 10 MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 2. Validação de Magic Bytes — impede arquivos mascarados com extensão falsa
    let detected = detectMagicBytes(buffer);
    // S-EMP-AUD-035: o upload em si vai pro R2 sem tratamento especial de formato — quem exige
    // JPEG/PNG/PDF é o pipeline de OCR (GPT-4o Vision, worker/cv_processor.py), que nem aceita
    // HEIC nem usa o mime real do arquivo (o data URI já sai hardcoded como "image/jpeg" hoje,
    // achado adjacente fora do escopo desta story). Por isso HEIC precisa ser CONVERTIDO aqui,
    // não só aceito cru — senão o upload "funciona" mas o OCR falha silenciosamente depois.
    let uploadBuffer: Buffer = buffer;
    let convertidoDeHeic = false;
    if (!detected && isHeic(buffer)) {
      try {
        uploadBuffer = await converterHeicParaJpeg(buffer, 0.9);
        detected = { bytes: [], mime: "image/jpeg", ext: "jpg" };
        convertidoDeHeic = true;
      } catch (heicErr: any) {
        console.warn("[upload-cv] HEIC detectado mas falhou ao converter:", {
          folder,
          extensaoArquivo: extensaoArquivo(file.name),
          erro: heicErr?.message,
          primeirosBytes: primeirosBytesHex(buffer),
        });
        // Sem `return` aqui — cai no bloco de rejeição padrão abaixo (`detected` continua null),
        // mesma mensagem de erro de sempre. Arquivo HEIC genuinamente corrompido não devia
        // parecer um formato diferente do que realmente é.
      }
    }
    if (!detected) {
      // S-EMP-AUD-034: warn, não erro — é uma rejeição esperada da validação, não uma falha do
      // sistema. Guarda o folder (carrega o vagaId embutido) e o nome/mime declarados pelo
      // cliente pra dar contexto sem expor conteúdo do arquivo.
      console.warn("[upload-cv] Rejeitado por magic bytes desconhecidos:", {
        folder,
        extensaoArquivo: extensaoArquivo(file.name),
        mimeDeclarado: file.type,
        tamanho: file.size,
        primeirosBytes: primeirosBytesHex(buffer),
      });
      return NextResponse.json(
        { error: "Arquivo inválido ou corrompido. Envie apenas PDF, Word, JPG ou PNG." },
        { status: 400 }
      );
    }

    // 3. MIME type declarado pelo cliente deve ser um dos permitidos — pulado quando já
    // convertemos de HEIC (o navegador declara "image/heic"/"image/heif" ou nada; o que importa
    // agora são os bytes reais, já convertidos pra JPEG de verdade).
    if (!convertidoDeHeic) {
      const clientMime = (file.type || "").toLowerCase();
      if (clientMime && !ALLOWED_MIMES.has(clientMime)) {
        console.warn("[upload-cv] Rejeitado por MIME declarado fora da lista permitida:", {
          folder,
          extensaoArquivo: extensaoArquivo(file.name),
          mimeDeclarado: clientMime,
          mimeDetectadoPorMagicBytes: detected.mime,
          primeirosBytes: primeirosBytesHex(buffer),
        });
        return NextResponse.json(
          { error: "Arquivo inválido ou corrompido. Envie apenas PDF, Word, JPG ou PNG." },
          { status: 400 }
        );
      }
    }

    // 4. Extensão canônica vem dos magic bytes (ou da conversão) — nunca do nome declarado pelo cliente
    const key = `${folder}/${Date.now()}_${crypto.randomUUID()}.${detected.ext}`;

    const publicUrl = await uploadToR2(key, uploadBuffer, detected.mime);

    return NextResponse.json({ url: publicUrl });
  } catch (err: any) {
    console.error("[upload-cv] Erro:", err);
    // S-EMP-AUD-034: log efêmero de servidor não é pesquisável por candidatura específica —
    // Sentry dá o contexto (folder carrega o vagaId embutido) pra diagnosticar sem depender de
    // uma conversa ao vivo acontecendo na hora (ver AUDITORIA-empregabilidade-2026-08-27, BUG-03).
    Sentry.captureException(err, {
      tags: { fluxo: "empregabilidade_upload_cv" },
      extra: { folder },
    });
    return NextResponse.json({ error: err.message || "Erro no upload." }, { status: 500 });
  }
}
