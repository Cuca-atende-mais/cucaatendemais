import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.CF_R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.CF_R2_BUCKET!;
const PUBLIC_URL = process.env.CF_R2_PUBLIC_URL!;

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_URL}/${key}`;
}

export async function deleteFromR2(keyOrUrl: string): Promise<void> {
  // Aceita tanto a chave direta quanto a URL pública completa
  const key = keyOrUrl.startsWith("http")
    ? keyOrUrl.replace(`${PUBLIC_URL}/`, "")
    : keyOrUrl;
  await r2Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
}
