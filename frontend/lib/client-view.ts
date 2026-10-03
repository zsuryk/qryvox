import {
  approvedAdviceFor,
  type CaseAdvice,
  type ClientProfile,
  type Explanation,
  explanationFor,
  fold,
  type KnowledgeLevel,
  type SlimEvent,
  type Verdict,
} from "@qryvox/shared";
import { productName } from "./case";

// What one client may see (#34), folded from the case's log. Only advice an adviser approved, still in
// play, ever reaches the client; everything else is said as where things stand, never shown.

export type ClientView =
  | { status: "approved"; advice: CaseAdvice; explanation: Explanation | null; profile: ClientProfile; product: string }
  | { status: "reviewing" | "rejected" | "none"; profile: ClientProfile | null; product: string };

export function clientView(events: readonly SlimEvent[], clientId: string): ClientView {
  const state = fold(events);
  const profile = state.clients.find((c) => c.clientId === clientId)?.profile ?? null;
  const product = productName(events) ?? "this product";
  const approved = approvedAdviceFor(state, clientId).at(-1);
  if (approved && profile) {
    return { status: "approved", advice: approved, explanation: explanationFor(events, approved.adviceId), profile, product };
  }
  const inPlay = state.advice.filter((a) => a.client_id === clientId && a.supersededAtSeq === null).at(-1);
  if (!inPlay) return { status: "none", profile, product };
  return { status: inPlay.decision?.decision === "rejected" ? "rejected" : "reviewing", profile, product };
}

// The verdict as a sentence to the client, not a label.
export const HEADLINE: Record<Verdict, string> = {
  suitable: "This product suits you.",
  conditional: "This product may suit you, once your adviser confirms one thing.",
  not_suitable: "This product does not suit you.",
};

// The three depths, named for the reader rather than for their expertise.
export const DEPTH: Record<KnowledgeLevel, string> = { novice: "Simple", informed: "Detailed", expert: "In full" };
