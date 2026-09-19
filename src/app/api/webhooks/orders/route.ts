import { processOrderWebhook } from "@/ingest/process-webhook";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature");
  const result = await processOrderWebhook(rawBody, signature);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, duplicate: result.duplicate });
}
