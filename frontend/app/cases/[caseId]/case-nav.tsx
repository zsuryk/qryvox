"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The case's four places, as a segmented control: one choice of four, a thumb that slides to it. Each
// is a link, so a section is a URL that can be shared, reloaded and gone back to. Canvas comes first and is
// where a case opens (#59); Review keeps its address, the case's own, as the list view and the run.
const SECTIONS = [
  { suffix: "/canvas", label: "Canvas" },
  { suffix: "", label: "Review" },
  { suffix: "/advice", label: "Advice" },
  { suffix: "/record", label: "Record" },
] as const;

export default function CaseNav({ caseId }: { caseId: string }) {
  const path = usePathname();
  const base = `/cases/${caseId}`;
  const current = Math.max(
    0,
    SECTIONS.findIndex((section) => path === base + section.suffix),
  );
  return (
    <nav aria-label="Case sections" className="segmented" style={{ "--segments": SECTIONS.length } as React.CSSProperties}>
      <span aria-hidden className="segmented__thumb" style={{ transform: `translateX(${current * 100}%)` }} />
      {SECTIONS.map((section, index) => (
        <Link key={section.label} href={base + section.suffix} aria-current={index === current ? "page" : undefined}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
