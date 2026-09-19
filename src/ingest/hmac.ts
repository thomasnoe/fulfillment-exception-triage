import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (signatureHeader === null || signatureHeader.length === 0) {
    return false;
  }
  const expected = signWebhookBody(rawBody, secret);
  const given = signatureHeader.trim().toLowerCase();
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(given, "utf8");
  if (expectedBuf.length !== givenBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, givenBuf);
}
