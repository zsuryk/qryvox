"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ClientProfile } from "@qryvox/shared";
import { blankProfile, newClientId } from "../lib/advice";
import { draftAdvice, recordClientList, recordProfile, runStep } from "../lib/api";
import { type Lang, WORDS } from "../lib/i18n";
import LanguageSwitch from "./language-switch";
import ProfileForm from "./profile-form";

// The client on their own (self-service): their questions, in their voice and their language (#43), and
// then — at once — their answers recorded under a pseudonymous id, the institution's rules applied, and an
// explanation written in the language they chose. Nothing is shown to them as advice until an adviser has
// confirmed it, and the page says so.

type Stage = { key: "recorded" | "checked" | "writing"; state: "doing" | "done" | "skipped" };

// Without a product (#71, /start) the answers are given once for the whole shelf: the server records them in
// every verified product's case and drafts each, and the client lands on their list. Nothing is written
// until they open a product.
export default function ClientStart({ caseId, product, ready }: { caseId: string | null; product: string | null; ready: boolean }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [stages, setStages] = useState<Stage[] | null>(null);
  const w = WORDS[lang].start;
  // The id is made up when the answers are sent, in the browser: made during render, the server and the
  // browser would each make up a different one.
  const start = blankProfile("client-new");

  async function submit(answers: ClientProfile) {
    const profile: ClientProfile = { ...answers, client_id: newClientId(), language: lang };
    const say = (key: Stage["key"], state: Stage["state"]) => setStages((s) => [...(s ?? []).filter((x) => x.key !== key), { key, state }]);
    if (caseId === null) {
      say("recorded", "doing");
      await recordClientList(crypto.randomUUID(), profile);
      say("recorded", "done");
      say("checked", "done");
      router.push(`/list/${profile.client_id}`);
      return;
    }
    say("recorded", "doing");
    await recordProfile(caseId, crypto.randomUUID(), profile, true);
    say("recorded", "done");
    say("checked", "doing");
    const adviceId = crypto.randomUUID();
    await draftAdvice(caseId, adviceId, profile.client_id);
    say("checked", "done");
    say("writing", "doing");
    // The explanation is a model call and can take a minute. If it fails, the advice still stands and its
    // reasons are shown in the rules' own words; nothing is lost.
    try {
      await runStep(caseId, { step_run_id: crypto.randomUUID(), step: "explain", input_run_id: adviceId });
      say("writing", "done");
    } catch {
      say("writing", "skipped");
    }
    router.push(`/clients/${caseId}/${profile.client_id}`);
  }

  return (
    <main className="page page--narrow" lang={lang === "en" ? "en" : "zh-Hant-HK"}>
      <div className="stack" style={{ "--stack-gap": "0.5rem", marginBottom: "2rem" } as React.CSSProperties}>
        <div className="row spread">
          <p className="t-eyebrow">{w.eyebrow}</p>
          {stages === null && <LanguageSwitch lang={lang} onChange={setLang} />}
        </div>
        <h1 className="t-large">{product ?? w.listTitle}</h1>
        <p className="t-body muted measure">{product === null ? w.listLead : w.lead}</p>
        <p className="t-footnote faint">{w.anonymity}</p>
      </div>

      {!ready ? (
        <div className="card">
          <p className="t-body">{product === null ? w.noProducts : w.notReady}</p>
        </div>
      ) : stages ? (
        <div className="card stack materialize" aria-live="polite" style={{ "--stack-gap": "0.75rem" } as React.CSSProperties}>
          {stages.map((s) => (
            <p key={s.key} className="row t-callout" style={{ "--row-gap": "0.625rem" } as React.CSSProperties}>
              <span className={`step__index${s.state === "done" ? " step__index--done" : s.state === "doing" ? " step__index--doing" : ""}`} aria-hidden>
                {s.state === "done" ? "✓" : s.state === "skipped" ? "–" : "…"}
              </span>
              {w[s.key]}
              {s.state === "doing" && s.key === "writing" && <span className="t-footnote muted">· {w.takesAMinute}</span>}
              {s.state === "skipped" && <span className="t-footnote muted">· {w.adviserWillExplain}</span>}
            </p>
          ))}
        </div>
      ) : (
        <div className="card">
          <ProfileForm
            initial={start}
            voice="client"
            lang={lang}
            submitLabel={w.submit}
            busyLabel={w.busy}
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
