"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The header's places, named for what is there. The current one is marked for assistive technology as
// well as by weight, so where the analyst stands is never only a matter of style.
const PLACES = [
  { href: "/", label: "New review" },
  { href: "/advise", label: "Advise" },
  { href: "/board", label: "Recorded case" },
  { href: "/canvas", label: "Canvas" },
] as const;

export default function SiteNav() {
  const path = usePathname();
  // A client's own page carries none of the analyst's places: it is theirs, and only theirs.
  if (["/clients/", "/start/", "/list/"].some((p) => path.startsWith(p)) || path === "/start") return null;
  return (
    <nav className="nav" aria-label="Main">
      {PLACES.map((place) => (
        <Link key={place.href} href={place.href} aria-current={path === place.href ? "page" : undefined}>
          {place.label}
        </Link>
      ))}
    </nav>
  );
}
