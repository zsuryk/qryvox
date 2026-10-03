"use client";

import type { Citation, SlimEvent } from "@qryvox/shared";
import { evidenceDocument } from "../lib/evidence";
import { EvidencePane } from "./evidence";
import { Sheet } from "./ui";

// The source document in a sheet over the dimmed page: the same pane the board opens beside a finding.
export default function CitationSheet({ events, citation, label, onClose }: { events: readonly SlimEvent[]; citation: Citation; label: string; onClose: () => void }) {
  const source = evidenceDocument(events, citation.document_id);
  return (
    <Sheet title={label} onClose={onClose}>
      {source === null ? (
        <p className="t-callout">This case&apos;s log names no document {citation.document_id}. The passage is quoted in full on the card.</p>
      ) : (
        <EvidencePane
          document={source}
          citation={{ documentId: citation.document_id, documentName: source.filename, page: citation.page, quote: citation.quote }}
        />
      )}
    </Sheet>
  );
}
