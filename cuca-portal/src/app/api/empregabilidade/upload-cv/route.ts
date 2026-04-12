import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";

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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "candidaturas";

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
      return NextResponse.json(
        { error: "Arquivo inválido ou corrompido. Envie apenas PDF, Word, JPG ou PNG." },
        { status: 400 }
      );
    }

    // 3. MIME type declarado pelo cliente deve ser um dos permitidos
    const clientMime = (file.type || "").toLowerCase();
    if (clientMime && !ALLOWED_MIMES.has(clientMime)) {
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
    return NextResponse.json({ error: err.message || "Erro no upload." }, { status: 500 });
  }
}
