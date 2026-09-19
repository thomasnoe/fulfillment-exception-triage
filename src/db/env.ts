export function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is missing. Copy .env.example to .env.local and paste the Neon connection string from the console.",
    );
  }
  return databaseUrl;
}

export function requireWebhookSecret(): string {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "WEBHOOK_SECRET is missing. Add it to .env.local (gitignored).",
    );
  }
  return secret;
}
