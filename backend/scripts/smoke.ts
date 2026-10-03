// pnpm smoke — hit the deployed backend end to end: health answers, a case opens, the pack ingests,
// the full pipeline runs, and the chain verifies. Re-runnable: every run uses fresh uuids, so a contract
// change shows up as a failed assertion here rather than in the demo. Nothing here persists outside the
// deployed database, which keeps one case per run.
//
//   pnpm smoke                                   # against the default deployment
//   SMOKE_BASE_URL=https://... pnpm smoke        # against any deployment
//   JUDGE_TOKEN=... pnpm smoke                   # when the judge-link token is switched on (#19)
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DOCUMENTS } from "@qryvox/shared/pack-source";
import { PackManifest, PDFJS_VERSION, type IngestedDocument, type StepName } from "@qryvox/shared";

const BASE = (process.env.SMOKE_BASE_URL ?? "https://qryvox-api.vercel.app").replace(/\/$/, "");
const JUDGE_TOKEN = process.env.JUDGE_TOKEN ?? "";

// The same five the browser drives, in this order (PIPELINE_STEPS in frontend/lib/pipeline.ts):
// each step consumes the completed run of the one before it, and compliance sits between the
// cross-check and the findings. attributes and explain are the advice-time steps, not the pipeline.
const PIPELINE: StepName[] = ["extract", "decompose", "contradictions", "compliance", "findings"];

// The fabricated pack, as record-fold-fixture describes it: page text from the pack's one authored
// source, identities and hashes from the manifest the browser serves.
const manifest = PackManifest.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../frontend/public/pack/manifest.json", import.meta.url)), "utf8")),
);
const documents: IngestedDocument[] = DOCUMENTS.map((source) => {
  const served = manifest.documents.find((d) => d.document_id === source.document_id);
  if (!served || served.filename !== source.filename || served.page_count !== source.pages.length) {
    throw new Error(`${source.document_id} is not in the served manifest as the pack source describes it`);
  }
  return {
    document_id: source.document_id,
    sha256: served.sha256,
    filename: served.filename,
    kind: source.kind,
    page_count: source.pages.length,
    pages: source.pages.map((page) => page.map((line) => line.replace(/^#+ /, "")).join("\n")),
    pdfjs_version: PDFJS_VERSION,
  };
});

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (JUDGE_TOKEN) headers["x-judge-token"] = JUDGE_TOKEN;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

console.log(`smoke against ${BASE}`);

const health = await call("GET", "/health");
check("GET /health responds ok", health.status === 200 && (health.json as { status?: string })?.status === "ok", `got ${health.status}`);
check(
  "/health carries the shared event vocabulary",
  Array.isArray((health.json as { eventTypes?: unknown })?.eventTypes) &&
    ((health.json as { eventTypes: string[] }).eventTypes ?? []).includes("step.completed"),
);

const opened = await call("POST", "/cases", { event_id: randomUUID() });
check("POST /cases opens a case", opened.status === 201 && typeof (opened.json as { case_id?: string })?.case_id === "string", `got ${opened.status}`);
const caseId = (opened.json as { case_id?: string })?.case_id;
if (!caseId) process.exit(1);

for (const document of documents) {
  const ingested = await call("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  check(`ingest ${document.document_id}`, ingested.status === 201, `got ${ingested.status}`);
}

let previousRunId: string | null = null;
for (const step of PIPELINE) {
  const stepRunId = randomUUID();
  const result = await call("POST", `/cases/${caseId}/steps`, { step_run_id: stepRunId, step, input_run_id: previousRunId });
  const body = result.json as { step?: string; step_run_id?: string; error?: string } | null;
  const ok = result.status === 200 && body?.step === step && body?.step_run_id === stepRunId;
  check(`step ${step} completes`, ok, `got ${result.status}${body?.error ? `: ${body.error}` : ""}`);
  if (!ok) {
    console.error("stopping the pipeline here: every later step would just fail against this one's missing run");
    break;
  }
  previousRunId = stepRunId;
}

const verify = await call("GET", `/cases/${caseId}/verify`);
const chain = verify.json as { intact?: boolean; broken_at_seq?: number | null; event_count?: number } | null;
check("chain verifies intact", verify.status === 200 && chain?.intact === true && chain?.broken_at_seq === null, `got ${verify.status}`);

const events = await call("GET", `/cases/${caseId}/events?after=0&limit=200`);
const list = (events.json as { events?: { type: string; payload?: { step?: string } }[] } | null)?.events ?? [];
check(
  "log holds a completed run of every step",
  PIPELINE.every((step) => list.some((e) => e.type === "step.completed" && e.payload?.step === step)),
);
check("log holds the case and its documents", list.some((e) => e.type === "case.opened") && list.filter((e) => e.type === "document.ingested").length === documents.length);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("smoke passed");
