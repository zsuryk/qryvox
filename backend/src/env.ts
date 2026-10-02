// Local defaults match .env.example; production values live only in the Vercel project (ADR-0001).
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? "http://localhost:3000",
  port: Number(process.env.PORT ?? 8787),
};
