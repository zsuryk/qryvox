import type { SlimEvent } from "@qryvox/shared";

// What a case is about, said the way a person would: the product's name as the attributes step read it
// from the documents, or, before that has run, the name of the pack's first document.
export function productName(events: readonly SlimEvent[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.type !== "step.completed" || event.payload.step !== "attributes") continue;
    const name = (event.payload.output as { product_name?: { value?: string } }).product_name?.value;
    if (name) return name;
  }
  return null;
}

// A moment from the log, written the same on the server and in the browser: the server renders in UTC on
// Vercel and the browser in the reader's zone, and two different strings would break hydration.
export function when(iso: string, style: "date" | "moment" = "moment"): string {
  const date = new Date(iso);
  return style === "date"
    ? date.toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" })
    : `${date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}
