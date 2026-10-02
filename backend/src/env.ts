// Local defaults match .env.example; production values live only in the Vercel project (ADR-0001).
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? "http://localhost:3000",
  port: Number(process.env.PORT ?? 8787),
  llm: llmConfig(),
};

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
