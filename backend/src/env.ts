// Local defaults match .env.example; production values live only in the Vercel project (ADR-0001).
const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

export const env = {
  databaseUrl,
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  port: Number(process.env.PORT ?? 8787),
  llm: llmConfig(),
  guards: {
    // Comma-separated; the frontend origin(s).
    allowedOrigins: (process.env.ALLOWED_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim()),
    ipHashSecret: ipHashSecret(),
    limits: {
      windowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 3600),
      stepsPerIp: Number(process.env.RATE_LIMIT_STEPS_PER_IP ?? 60),
      stepsPerCase: Number(process.env.RATE_LIMIT_STEPS_PER_CASE ?? 24),
    },
  },
};

// Required against a hosted database: every instance must hash with the same key, or the per-IP limit
// splits across instances. A local file database gets a fixed development key.
function ipHashSecret(): string {
  const secret = process.env.IP_HASH_SECRET;
  if (secret) return secret;
  if (databaseUrl.startsWith("file:")) return "local-development-only";
  throw new Error("IP_HASH_SECRET must be set when DATABASE_URL is not a local file");
}

// Any OpenAI-compatible chat-completions endpoint: a hosted provider, or Ollama / LM Studio / vLLM locally.
// Unset LLM_BASE_URL or LLM_MODEL leaves the model unconfigured; new steps then answer 503.
function llmConfig() {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !model) return null;
  const temperature = process.env.LLM_TEMPERATURE ?? "0";
  return {
    baseUrl,
    model,
    apiKey: process.env.LLM_API_KEY || undefined,
    // "none" omits it, for models that reject a temperature.
    temperature: temperature === "none" ? undefined : Number(temperature),
    // Under Vercel's 300 s function limit; local models are slow.
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 240_000),
  };
}
