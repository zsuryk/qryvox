# Model spend protection

The demo URL is public, so anyone who finds it can make the backend call the model. The real bill is
model tokens, not hosting (ADR-0001). Four layers protect it. Three are in the code; the last is an
operations step that has to be done by hand.

**Owner: @zsuryk** (the release owner, who holds the Vercel Hobby account and the production model key).

## 1. API token (code)

The demo URL carries `?k=<token>`; the frontend keeps it in `sessionStorage` and sends it as the
`x-api-token` header. With `API_TOKEN` set on the backend Vercel project, an analysis step without the
matching header answers 401 before the model is called. Only steps need it: the board and replay stay open.
Unlike the origin allow-list, it also stops requests that send no Origin, such as `curl`.

Unset, steps are open, which is right for local development and wrong for the public demo URL. Set it
(`openssl rand -hex 16`) only once the deployed frontend sends the header, or every step will be refused.
Share the URL with the token on it; anyone holding that URL can run steps, so layers 3 and 4 still matter.

## 2. Origin allow-list (code)

The backend refuses browser requests from any origin not listed in `ALLOWED_ORIGIN` (403), so no other
site can drive the API from a visitor's browser. Set `ALLOWED_ORIGIN` on the backend Vercel project to the
frontend's production URL.

## 3. Rate limit (code)

Before a step calls the model, the backend counts recent `step.started` events in the events table, per
hashed client IP across all cases and per case. Over either limit it answers 429 with `Retry-After`.
A retry that returns a stored result spends nothing and is never limited. Defaults are 60 steps per IP
and 24 per case per hour (`RATE_LIMIT_*`). A full pipeline run is 4 steps.

Client IPs are stored only as an HMAC keyed by `IP_HASH_SECRET`. Set it on the backend Vercel project to a
long random value (`openssl rand -hex 32`) and never commit it. Rotating it resets the per-IP counts.

## 4. Hard spend limit at the provider (operations, required before sharing the demo URL)

Layers 1–3 stop or slow abuse; only the provider can stop the bill. Before the demo URL is shared:

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
