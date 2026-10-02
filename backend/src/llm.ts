// The model client speaks the OpenAI-compatible chat-completions protocol and nothing else: no provider
// SDK, so nothing in the workflow knows which vendor answers (spec decision 22). Hosted providers, Ollama,
// LM Studio, vLLM and llama.cpp all serve it; the endpoint, key and model come from the environment.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Completion = {
  // The assistant message text.
  content: string;
  // The whole response body, stored on the step event for audit.
  raw: unknown;
};

export interface Llm {
  readonly model: string;
  complete(messages: ChatMessage[]): Promise<Completion>;
}

export class LlmError extends Error {
  override name = "LlmError";
  constructor(
    message: string,
    readonly raw: unknown = null,
  ) {
    super(message);
  }
}

export type LlmConfig = {
  baseUrl: string;
  // Optional: local servers take none, and then no Authorization header is sent.
  apiKey?: string | undefined;
  model: string;
  // Omitted from the request when undefined, for models that reject a temperature.
  temperature?: number | undefined;
  timeoutMs: number;
  fetch?: typeof fetch;
};

export function createLlm(config: LlmConfig): Llm {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch = config.fetch ?? fetch;

  return {
    model: config.model,
    async complete(messages) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
            stream: false,
          }),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (err) {
        throw new LlmError(`model endpoint unreachable: ${(err as Error).message}`);
      }

      const text = await res.text();
      let raw: unknown = text;
      try {
        raw = JSON.parse(text);
      } catch {
        // keep the text as the raw response
      }
      if (!res.ok) throw new LlmError(`model endpoint returned ${res.status}`, raw);

      const content = (raw as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new LlmError("model response has no message content", raw);
      return { content, raw };
    },
  };
}

// Pulls the JSON object out of a model reply: drops <think>…</think> reasoning (DeepSeek-R1, Qwen3 and
// others emit it inline) and Markdown code fences, then takes the outermost {…}. Returns undefined when
// there is nothing parseable; the step records that as a failure.
export function extractJson(content: string): unknown {
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
