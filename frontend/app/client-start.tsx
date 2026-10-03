"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ClientProfile } from "@qryvox/shared";
import { blankProfile, newClientId } from "../lib/advice";
import { draftAdvice, recordProfile, runStep } from "../lib/api";
import ProfileForm from "./profile-form";

// The client on their own (self-service): their questions, in their voice, and then — at once — their
// answers recorded under a pseudonymous id, the institution's rules applied, and an explanation written.
// Nothing is shown to them as advice until an adviser has confirmed it, and the page says so.

type Stage = { label: string; state: "doing" | "done" | "skipped" };

export default function ClientStart({ caseId, product, ready }: { caseId: string; product: string; ready: boolean }) {
  const router = useRouter();
  const [stages, setStages] = useState<Stage[] | null>(null);
  // The id is made up when the answers are sent, in the browser: made during render, the server and the
  // browser would each make up a different one.
  const start = blankProfile("client-new");

  async function submit(profile: ClientProfile) {
    const say = (label: string, state: Stage["state"]) =>
      setStages((s) => [...(s ?? []).filter((x) => x.label !== label), { label, state }]);
    profile = { ...profile, client_id: newClientId() };
    say("Your answers are recorded", "doing");
    await recordProfile(caseId, crypto.randomUUID(), profile, true);
    say("Your answers are recorded", "done");
    say("Checked against the institution's rules", "doing");
    const adviceId = crypto.randomUUID();
    await draftAdvice(caseId, adviceId, profile.client_id);
    say("Checked against the institution's rules", "done");
    say("Writing your explanation", "doing");
    // The explanation is a model call and can take a minute. If it fails, the advice still stands and its
    // reasons are shown in the rules' own words; nothing is lost.
    try {
      await runStep(caseId, { step_run_id: crypto.randomUUID(), step: "explain", input_run_id: adviceId });
      say("Writing your explanation", "done");
    } catch {
      say("Writing your explanation", "skipped");
    }
    router.push(`/clients/${caseId}/${profile.client_id}`);
  }

  return (
    <main className="page page--narrow">
      <div className="stack" style={{ "--stack-gap": "0.5rem", marginBottom: "2rem" } as React.CSSProperties}>
        <p className="t-eyebrow">Is it right for you?</p>
        <h1 className="t-large">{product}</h1>
        <p className="t-body muted measure">
          Answer a few questions. The institution&apos;s rules check this product against your answers straight away, every reason
          tied to the product&apos;s own documents. Your adviser confirms the result before you see it.
        </p>
        <p className="t-footnote faint">
          No name, no account: you are known only by an id made up for you when you send your answers. The product is fabricated
          for a demonstration.
        </p>
      </div>

      {!ready ? (
        <div className="card">
          <p className="t-body">This product is still being checked. Please come back once your adviser has finished reviewing it.</p>
        </div>
      ) : stages ? (
        <div className="card stack materialize" aria-live="polite" style={{ "--stack-gap": "0.75rem" } as React.CSSProperties}>
          {stages.map((s) => (
            <p key={s.label} className="row t-callout" style={{ "--row-gap": "0.625rem" } as React.CSSProperties}>
              <span className={`step__index${s.state === "done" ? " step__index--done" : s.state === "doing" ? " step__index--doing" : ""}`} aria-hidden>
                {s.state === "done" ? "✓" : s.state === "skipped" ? "–" : "…"}
              </span>
              {s.label}
              {s.state === "doing" && s.label.startsWith("Writing") && <span className="t-footnote muted">· this can take a minute</span>}
              {s.state === "skipped" && <span className="t-footnote muted">· your adviser will explain it</span>}
            </p>
          ))}
        </div>
      ) : (
        <div className="card">
          <ProfileForm
            initial={start}
            voice="client"
            submitLabel="See if it suits me"
            busyLabel="Checking…"
            onSubmit={async (profile) => {
              setStages([]);
              try {
                await submit(profile);
              } catch (cause) {
                setStages(null);
                throw cause;
              }
            }}
          />
        </div>
      )}
    </main>
  );
}
