"use client";

import type { Lang } from "../lib/i18n";
import { Segmented } from "./ui";

// The client's language, chosen with one tap: each option is written in its own language.
export default function LanguageSwitch({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  return (
    <Segmented<Lang>
      label="Language / 語言"
      value={lang}
      options={[
        { value: "en", label: "English" },
        { value: "zh-Hant", label: "繁體中文" },
      ]}
      onChange={onChange}
    />
  );
}
