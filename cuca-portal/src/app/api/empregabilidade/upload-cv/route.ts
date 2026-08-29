import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";
import * as Sentry from "@sentry/nextjs";

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
    const detected = detectMagicBytes(buffer);
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

    // 3. MIME type declarado pelo cliente deve ser um dos permitidos
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

    // 4. Extensão canônica vem dos magic bytes — nunca do nome declarado pelo cliente
    const key = `${folder}/${Date.now()}_${crypto.randomUUID()}.${detected.ext}`;

    const publicUrl = await uploadToR2(key, buffer, detected.mime);

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
