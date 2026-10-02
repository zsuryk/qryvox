# Model spend protection

The judge URL is public, so anyone who finds it can make the backend call the model. The real bill is
model tokens, not hosting (ADR-0001). Three layers protect it. Two are in the code; the third is an
operations step that has to be done by hand.

**Owner: @zsuryk** (the release owner, who holds the Vercel Hobby account and the production model key).

## 1. Origin allow-list (code)

The backend refuses browser requests from any origin not listed in `ALLOWED_ORIGIN` (403), so no other
site can drive the API from a visitor's browser. Set `ALLOWED_ORIGIN` on the backend Vercel project to the
frontend's production URL.

## 2. Rate limit (code)

Before a step calls the model, the backend counts recent `step.started` events in the events table, per
hashed client IP across all cases and per case. Over either limit it answers 429 with `Retry-After`.
A retry that returns a stored result spends nothing and is never limited. Defaults are 60 steps per IP
and 24 per case per hour (`RATE_LIMIT_*`). A full pipeline run is 4 steps.

Client IPs are stored only as an HMAC keyed by `IP_HASH_SECRET`. Set it on the backend Vercel project to a
long random value (`openssl rand -hex 32`) and never commit it. Rotating it resets the per-IP counts.

## 3. Hard spend limit at the provider (operations, required before sharing the judge URL)

Layers 1 and 2 slow abuse down; only the provider can stop the bill. Before the judge URL is shared:

1. In the console of the provider behind `LLM_BASE_URL`, create a **dedicated API key** for this project.
   Use it only as `LLM_API_KEY` on the backend Vercel project.
2. Set a **hard monthly spend limit** on that key or on its project/workspace. The provider should refuse
   requests once it is reached, not just send an alert. Choose the smallest amount that covers the demo;
   a full pipeline run over the fabricated pack is a few thousand tokens.
3. Add an **alert** at about 50% of the limit, sent to the owner.
4. Write the limit, the date it was set and where to change it in the team's release notes.
5. After demo night, revoke the key or lower the limit.

Where the setting lives differs by provider (OpenAI: project limits; Anthropic: workspace spend limits;
OpenRouter: per-key credit limit). Check that the limit really blocks requests, not only alerts.
A local model (Ollama, LM Studio) costs nothing per token, but a deployed backend cannot reach it.
