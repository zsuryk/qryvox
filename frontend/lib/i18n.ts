import {
  type ClientGoal,
  type ClientLanguage,
  type ClientProfile,
  type Exclusion,
  type KnowledgeLevel,
  type ReasonEffect,
  type SuitabilityRuleId,
  type Verdict,
  VERDICT_HEADLINE,
} from "@qryvox/shared";

// Everything a client reads, in English and in Traditional Chinese as used in Hong Kong (#43). One table,
// so a string cannot exist in one language and not the other: the type checker holds them in step. The
// adviser's console stays in English; quoted document text stays in the document's own language.

export type Lang = ClientLanguage;

type Words = {
  languageName: string;
  goal: Record<ClientGoal, string>;
  knowledge: Record<KnowledgeLevel, string>;
  exclusion: Record<Exclusion, string>;
  effect: Record<ReasonEffect, string>;
  verdict: Record<Verdict, string>;
  depth: Record<KnowledgeLevel, string>;
  rule: Record<SuitabilityRuleId, string>;
  years: (n: number) => string;
  riskLevel: (n: number) => string;
  // The questionnaire, in the client's own voice.
  form: {
    goal: string;
    horizon: string;
    risk: string;
    riskHint: string;
    riskQuestions: readonly { question: string; options: readonly string[] }[];
    riskUnanswered: string;
    riskResult: (n: number) => string;
    knowledge: string;
    knowledgeHint: string;
    circumstances: string;
    income: string;
    cash: string;
    age: string;
    exclusions: string;
  };
  start: {
    eyebrow: string;
    lead: string;
    anonymity: string;
    notReady: string;
    submit: string;
    busy: string;
    recorded: string;
    checked: string;
    writing: string;
    takesAMinute: string;
    adviserWillExplain: string;
  };
  advice: {
    eyebrow: string;
    reviewing: string;
    rejected: string;
    none: string;
    vulnerable: string;
    waiting: string;
    why: string;
    detail: string;
    source: (document: string, page: number) => string;
    noSource: string;
    know: string;
    knowSource: string;
    noneFit: string;
    share: string;
    shared: (n: number) => string;
    approved: (actor: string, date: string | null, rules: string) => string;
    fabricated: string;
  };
  // The shelf comparison (#68): every verified product, as the rules find it for this client.
  shelf: {
    title: string;
    caption: string;
    thisProduct: string;
    verdict: (product: string) => Record<Verdict, string>;
    meetsAll: string;
    askAdviser: string;
  };
  answers: {
    title: string;
    note: string;
    field: Record<"goal" | "horizon_years" | "risk_level" | "knowledge" | "relies_on_income" | "may_need_cash_at_short_notice" | "aged_65_or_over" | "exclusions", string>;
    reliesYes: string;
    reliesNo: string;
    cashYes: string;
    cashNo: string;
    ageYes: string;
    ageNo: string;
    noExclusions: string;
    excludes: (list: string) => string;
  };
};

export const WORDS: Record<Lang, Words> = {
  en: {
    languageName: "English",
    goal: { income: "Income", growth: "Growth", preservation: "Keeping capital safe" },
    knowledge: { novice: "New to investing", informed: "Some experience", expert: "Experienced" },
    exclusion: { fossil_fuels: "Fossil fuels", tobacco: "Tobacco", weapons: "Weapons" },
    effect: { meets: "Meets", warns: "Warning", conditional: "Needs confirmation", blocks: "Fails" },
    // The headline above the explanation, in shared so the explain step can refuse a summary repeating it (#67).
    verdict: VERDICT_HEADLINE.en,
    depth: { novice: "Simple", informed: "Detailed", expert: "In full" },
    rule: {
      S1: "Long enough horizon",
      S2: "Risk within your level",
      S3: "Where the income comes from",
      S4: "Money available when needed",
      S5: "Exclusions backed by the PPM",
      S6: "Things you must be told",
      S7: "Built for what you want",
    },
    years: (n) => `${n} ${n === 1 ? "year" : "years"}`,
    riskLevel: (n) => `Risk level ${n} of 5`,
    form: {
      goal: "What is this money for?",
      horizon: "How long can you leave it invested?",
      risk: "How you feel about losses",
      riskHint: "Three quick questions. There are no wrong answers.",
      riskQuestions: [
        { question: "If this investment fell by a fifth in a year, what would you do?", options: ["Sell everything", "Sell some", "Wait and see", "Hold calmly", "Buy more"] },
        { question: "Which matters more to you?", options: ["Never losing money", "Mostly safety", "A balance", "Mostly growth", "The most growth"] },
        { question: "How would a large loss affect your plans?", options: ["It would change everything", "It would hurt a lot", "Manageable", "A setback, no more", "Easily absorbed"] },
      ],
      riskUnanswered: "Answer all three to set the level.",
      riskResult: (n) => `Your answers give risk level ${n} of 5.`,
      knowledge: "How much do you know about investing?",
      knowledgeHint: "Your advice will be explained at this level. You can change it when you read it.",
      circumstances: "Your situation",
      income: "I rely on the income it pays",
      cash: "I may need the money at short notice",
      age: "I am 65 or over",
      exclusions: "I will not invest in",
    },
    start: {
      eyebrow: "Is it right for you?",
      lead: "Answer a few questions. The institution's rules check this product against your answers straight away, every reason tied to the product's own documents. Your adviser confirms the result before you see it.",
      anonymity: "No name, no account: you are known only by an id made up for you when you send your answers. The product is fabricated for a demonstration.",
      notReady: "This product is still being checked. Please come back once your adviser has finished reviewing it.",
      submit: "See if it suits me",
      busy: "Checking…",
      recorded: "Your answers are recorded",
      checked: "Checked against the institution's rules",
      writing: "Writing your explanation",
      takesAMinute: "this can take a minute",
      adviserWillExplain: "your adviser will explain it",
    },
    advice: {
      eyebrow: "Your advice",
      reviewing: "Your answers are in, and the institution's rules have been applied. Your adviser is checking the result; it appears here as soon as they confirm it.",
      rejected: "Your adviser is preparing new advice for you.",
      none: "There is no advice for you here yet.",
      vulnerable: "Your adviser will speak with you before confirming it, to make sure it is explained properly.",
      waiting: "Waiting for your adviser. This page updates by itself.",
      why: "Why",
      detail: "How much detail",
      source: (document, page) => `Where this comes from · ${document} page ${page}`,
      noSource: "Nothing in the product's documents speaks to this.",
      know: "Things you should know",
      knowSource: "Things you should know",
      noneFit: "Nothing else your adviser has checked fits you either. They will talk you through what to do next.",
      share: "Let my adviser see which level of detail I choose, so they can explain things my way.",
      shared: (n) => (n === 0 ? "Nothing shared yet." : `Shared ${n} ${n === 1 ? "choice" : "choices"}.`),
      approved: (actor, date, rules) => `Approved by your adviser (${actor})${date ? ` on ${date}` : ""}. Drafted by the institution's rules, ${rules}.`,
      fabricated: "The product, its issuer and this client are fabricated for a demonstration. Nothing here is an offer.",
    },
    shelf: {
      title: "Compared with every product your adviser has checked",
      caption: "These are the results of the institution's rules, applied to each product in the same way. They are not a recommendation: only the product this page is about, listed first, is your adviser's advice.",
      thisProduct: "The product this page is about",
      verdict: (product) => ({
        suitable: `${product} suits you.`,
        conditional: `${product} may suit you, once your adviser confirms one thing.`,
        not_suitable: `${product} does not suit you.`,
      }),
      meetsAll: "It meets every rule.",
      askAdviser: "Ask your adviser about it.",
    },
    answers: {
      title: "What you told us",
      note: "Something wrong? Tell your adviser: new answers set this advice aside and the rules are applied again.",
      field: {
        goal: "The money is for",
        horizon_years: "You can leave it invested",
        risk_level: "Your attitude to risk",
        knowledge: "Your investing knowledge",
        relies_on_income: "Income",
        may_need_cash_at_short_notice: "Access to your money",
        aged_65_or_over: "Your age",
        exclusions: "You will not invest in",
      },
      reliesYes: "Relies on the income",
      reliesNo: "Does not rely on the income",
      cashYes: "May need the money at short notice",
      cashNo: "Will not need the money at short notice",
      ageYes: "65 or over",
      ageNo: "Under 65",
      noExclusions: "No exclusions",
      excludes: (list) => `Excludes ${list}`,
    },
  },
  "zh-Hant": {
    languageName: "繁體中文",
    goal: { income: "收入", growth: "增長", preservation: "保本" },
    knowledge: { novice: "投資新手", informed: "有一些經驗", expert: "經驗豐富" },
    exclusion: { fossil_fuels: "化石燃料", tobacco: "煙草", weapons: "武器" },
    effect: { meets: "符合", warns: "提醒", conditional: "待確認", blocks: "不符合" },
    verdict: VERDICT_HEADLINE["zh-Hant"],
    depth: { novice: "簡單", informed: "詳細", expert: "完整" },
    rule: {
      S1: "投資期是否足夠",
      S2: "風險是否在你的承受範圍內",
      S3: "收益從何而來",
      S4: "需要時能否取回資金",
      S5: "你不投資的項目是否有 PPM 支持",
      S6: "必須告訴你的事",
      S7: "產品是否為你的目標而設",
    },
    years: (n) => `${n} 年`,
    riskLevel: (n) => `風險等級 ${n}（共 5 級）`,
    form: {
      goal: "這筆錢的用途是？",
      horizon: "你可以投資多久？",
      risk: "你對虧損的感受",
      riskHint: "三個簡單問題，沒有對錯之分。",
      riskQuestions: [
        { question: "如果這項投資一年內下跌兩成，你會怎樣做？", options: ["全部賣出", "賣出部分", "先觀望", "冷靜持有", "趁低加碼"] },
        { question: "哪一樣對你更重要？", options: ["絕不虧損", "以安全為主", "兩者平衡", "以增長為主", "追求最高增長"] },
        { question: "較大的虧損會怎樣影響你的計劃？", options: ["會徹底改變", "影響很大", "可以應付", "只是小挫折", "可以輕鬆承受"] },
      ],
      riskUnanswered: "回答全部三題後會得出風險等級。",
      riskResult: (n) => `你的答案得出風險等級 ${n}（共 5 級）。`,
      knowledge: "你對投資有多少認識？",
      knowledgeHint: "你的建議會按這個程度解釋，閱讀時可以再更改。",
      circumstances: "你的情況",
      income: "我依靠它派發的收入",
      cash: "我可能需要在短時間內取回資金",
      age: "我今年 65 歲或以上",
      exclusions: "我不會投資於",
    },
    start: {
      eyebrow: "適合你嗎？",
      lead: "回答幾個問題。機構的規則會立即按你的答案檢查這個產品，每個理由都對應產品文件的原文。你的顧問確認結果後，你才會看到。",
      anonymity: "不用姓名，不用開戶：你只會以一個在提交答案時為你產生的代號識別。此產品為示範而虛構。",
      notReady: "這個產品仍在審核中。請在你的顧問完成審核後再回來。",
      submit: "看看是否適合我",
      busy: "檢查中…",
      recorded: "已記錄你的答案",
      checked: "已按機構規則檢查",
      writing: "正在撰寫你的說明",
      takesAMinute: "可能需要一分鐘",
      adviserWillExplain: "你的顧問會向你解釋",
    },
    advice: {
      eyebrow: "你的建議",
      reviewing: "已收到你的答案，並已按機構規則完成檢查。你的顧問正在確認結果，確認後會立即在這裡顯示。",
      rejected: "你的顧問正在為你準備新的建議。",
      none: "這裡暫時沒有你的建議。",
      vulnerable: "你的顧問會先與你聯絡，確保向你解釋清楚，然後才確認。",
      waiting: "正在等待你的顧問確認。此頁面會自動更新。",
      why: "原因",
      detail: "詳細程度",
      source: (document, page) => `出處 · ${document} 第 ${page} 頁`,
      noSource: "產品文件沒有提及這一點。",
      know: "你需要知道的事",
      knowSource: "你需要知道的事",
      noneFit: "你的顧問檢查過的其他產品也不適合你。顧問會與你商量下一步。",
      share: "讓我的顧問知道我選擇哪種詳細程度，以便用我習慣的方式解釋。",
      shared: (n) => (n === 0 ? "尚未分享。" : `已分享 ${n} 次選擇。`),
      approved: (actor, date, rules) => `由你的顧問（${actor}）${date ? `於 ${date} ` : ""}確認。按機構規則 ${rules} 起草。`,
      fabricated: "此產品、發行商及客戶均為示範而虛構，並非任何要約。",
    },
    shelf: {
      title: "與你的顧問核實過的所有產品比較",
      caption: "以下是機構規則以同一方式檢查每個產品的結果，並非建議。只有本頁所講、列在最前的產品，才是你的顧問的建議。",
      thisProduct: "本頁所講的產品",
      verdict: (product) => ({
        suitable: `${product} 適合你。`,
        conditional: `${product} 可能適合你，需待你的顧問確認一點。`,
        not_suitable: `${product} 不適合你。`,
      }),
      meetsAll: "符合所有規則。",
      askAdviser: "可以向你的顧問查詢。",
    },
    answers: {
      title: "你告訴我們的",
      note: "資料有誤？請告訴你的顧問：新的答案會令這份建議作廢，並重新按規則檢查。",
      field: {
        goal: "這筆錢的用途",
        horizon_years: "可以投資多久",
        risk_level: "你對風險的態度",
        knowledge: "你的投資知識",
        relies_on_income: "收入",
        may_need_cash_at_short_notice: "取用資金",
        aged_65_or_over: "你的年齡",
        exclusions: "你不投資的項目",
      },
      reliesYes: "依靠這筆收入",
      reliesNo: "不依靠這筆收入",
      cashYes: "可能需要在短時間內取回資金",
      cashNo: "不需要在短時間內取回資金",
      ageYes: "65 歲或以上",
      ageNo: "65 歲以下",
      noExclusions: "沒有限制",
      excludes: (list) => `不投資：${list}`,
    },
  },
};

// One answer, said back to the client in their language.
export function answerIn(lang: Lang, profile: ClientProfile, field: keyof Words["answers"]["field"]): string {
  const w = WORDS[lang];
  switch (field) {
    case "goal":
      return w.goal[profile.goal];
    case "horizon_years":
      return w.years(profile.horizon_years);
    case "risk_level":
      return w.riskLevel(profile.risk_level);
    case "knowledge":
      return w.knowledge[profile.knowledge];
    case "relies_on_income":
      return profile.relies_on_income ? w.answers.reliesYes : w.answers.reliesNo;
    case "may_need_cash_at_short_notice":
      return profile.may_need_cash_at_short_notice ? w.answers.cashYes : w.answers.cashNo;
    case "aged_65_or_over":
      return profile.aged_65_or_over ? w.answers.ageYes : w.answers.ageNo;
    case "exclusions":
      return profile.exclusions.length === 0
        ? w.answers.noExclusions
        : w.answers.excludes(profile.exclusions.map((e) => w.exclusion[e]).join(lang === "en" ? ", " : "、"));
  }
}

// A date, written the same on the server and in the browser (UTC), in the reader's language.
export function dateIn(lang: Lang, iso: string): string {
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "zh-HK", { dateStyle: "long", timeZone: "UTC" });
}
