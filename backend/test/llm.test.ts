import { describe, expect, it } from "vitest";
import { createLlm, extractJson, LlmError } from "../src/llm";

type Captured = { url: string; init: RequestInit };

function fakeEndpoint(status: number, body: unknown) {
  const captured: Captured[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { captured, fetch };
}

const reply = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });

describe("the OpenAI-compatible client", () => {
  it("posts the model and messages to <base>/chat/completions and returns the message content", async () => {
    const endpoint = fakeEndpoint(200, reply("hello"));
    const llm = createLlm({ baseUrl: "https://api.example.test/v1/", apiKey: "sk-test", model: "m-1", temperature: 0, timeoutMs: 1000, fetch: endpoint.fetch });

    const completion = await llm.complete([{ role: "user", content: "hi" }]);

    expect(completion).toEqual({ content: "hello", raw: reply("hello") });
    const [call] = endpoint.captured;
    expect(call?.url).toBe("https://api.example.test/v1/chat/completions");
    expect(new Headers(call?.init.headers).get("authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      model: "m-1",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
      stream: false,
    });
  });

  it("sends no Authorization header and no temperature when neither is configured, as local servers expect", async () => {
    const endpoint = fakeEndpoint(200, reply("ok"));
    const llm = createLlm({ baseUrl: "http://localhost:11434/v1", model: "qwen", timeoutMs: 1000, fetch: endpoint.fetch });

    await llm.complete([{ role: "user", content: "hi" }]);

    const [call] = endpoint.captured;
    expect(new Headers(call?.init.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(call?.init.body))).not.toHaveProperty("temperature");
  });

  it("raises LlmError carrying the body when the endpoint answers an error status", async () => {
    const endpoint = fakeEndpoint(401, { error: { message: "bad key" } });
    const llm = createLlm({ baseUrl: "https://api.example.test/v1", model: "m", timeoutMs: 1000, fetch: endpoint.fetch });

    const err = await llm.complete([]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).message).toBe("model endpoint returned 401");
    expect((err as LlmError).raw).toEqual({ error: { message: "bad key" } });
  });
});

describe("extractJson", () => {
  it("reads a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("drops <think> reasoning and code fences around the object", () => {
    const content = '<think>The user wants {statements}. Let me list them.</think>\n```json\n{"statements":[]}\n```';
    expect(extractJson(content)).toEqual({ statements: [] });
  });

  it("returns undefined when there is no parseable object", () => {
    expect(extractJson("No statements found.")).toBeUndefined();
    expect(extractJson("{ not json }")).toBeUndefined();
  });

  it("closes brackets a model left open at the end of a long reply, and nothing else", () => {
    // Kimi K3, on an explanation: the reply was whole but for its last brace.
    expect(extractJson('{"depths":{"novice":{"summary":"ok","passages":[{"ref":"r0","text":"a } and a ] inside"}]}}')).toEqual({
      depths: { novice: { summary: "ok", passages: [{ ref: "r0", text: "a } and a ] inside" }] } },
    });
    expect(extractJson('{"a":[1,2,{"b":"c"}')).toEqual({ a: [1, 2, { b: "c" }] });
  });

  it("does not repair a reply that is wrong in any other way", () => {
    // A bracket closed that was never opened, a reply cut off inside a string, a missing comma.
    expect(extractJson('{"a":1]}')).toBeUndefined();
    expect(extractJson('{"a":"cut off')).toBeUndefined();
    expect(extractJson('{"a":1 "b":2}')).toBeUndefined();
  });
});
