"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The case's three places, as a segmented control: one choice of three, a thumb that slides to it. Each
// is a link, so a section is a URL that can be shared, reloaded and gone back to.
const SECTIONS = [
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
