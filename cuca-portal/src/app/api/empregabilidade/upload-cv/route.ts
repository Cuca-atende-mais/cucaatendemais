import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Magic bytes aceitos: PDF, JPEG, PNG
const MAGIC_SIGNATURES: Array<{ bytes: number[]; mime: string }> = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" },   // %PDF
  { bytes: [0xff, 0xd8, 0xff],        mime: "image/jpeg" },        // JPEG
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },          // PNG
];

function detectMagicBytes(buf: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return sig.mime;
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

    // 2. Validação de Magic Bytes — impede upload de arquivos mascarados
    const detectedMime = detectMagicBytes(buffer);
    if (!detectedMime) {
      return NextResponse.json(
        { error: "Formato de arquivo inválido. Envie um PDF, JPG ou PNG." },
        { status: 400 }
      );
    }

    // 3. Consistência entre magic bytes e MIME type declarado pelo cliente
    const clientMime = file.type || "";
    if (clientMime && clientMime !== detectedMime) {
      return NextResponse.json(
        { error: "Tipo de arquivo inconsistente. O arquivo enviado não corresponde à extensão declarada." },
        { status: 400 }
      );
    }

    // 4. Usar extensão canônica derivada dos magic bytes (nunca confiar no nome do arquivo)
    const extMap: Record<string, string> = {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
    };
    const ext = extMap[detectedMime] ?? "bin";
    const key = `${folder}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

    const publicUrl = await uploadToR2(key, buffer, detectedMime);

    return NextResponse.json({ url: publicUrl });
  } catch (err: any) {
    console.error("[upload-cv] Erro:", err);
    return NextResponse.json({ error: err.message || "Erro no upload." }, { status: 500 });
  }
}
