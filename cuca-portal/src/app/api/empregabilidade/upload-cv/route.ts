import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "candidaturas";

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
    }

    const ext = file.name.split(".").pop() || "pdf";
    const key = `${folder}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const publicUrl = await uploadToR2(key, buffer, file.type || "application/pdf");

    return NextResponse.json({ url: publicUrl });
  } catch (err: any) {
    console.error("[upload-cv] Erro:", err);
    return NextResponse.json({ error: err.message || "Erro no upload." }, { status: 500 });
  }
}
