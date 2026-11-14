import { DATA_TOPICS } from "./content/dataGovernance";
import { DASHBOARD_TOPICS, ENDPOINT_HUB_TOPICS } from "./content/endpointHub";
import { ADMIN_TOPICS, IDENTITY_TOPICS } from "./content/identityAdmin";
import { NETWORK_APP_TOPICS, SECURITY_TOPICS } from "./content/security";
import { THREAT_TOPICS } from "./content/threatProtection";
import type { HelpTarget, HelpTopic, HowTo } from "./types";

export type { HelpStep, HelpTarget, HelpTopic, HowTo } from "./types";

// In sidebar order.
export const HELP_TOPICS: HelpTopic[] = [
  ...DASHBOARD_TOPICS,
  ...ENDPOINT_HUB_TOPICS,
  // App Center topics follow Identity Governance, as in the sidebar.
  ...NETWORK_APP_TOPICS.filter((t) => t.module !== "App Center"),
  ...SECURITY_TOPICS,
  ...DATA_TOPICS,
  ...THREAT_TOPICS,
  ...IDENTITY_TOPICS,
  ...NETWORK_APP_TOPICS.filter((t) => t.module === "App Center"),
  ...ADMIN_TOPICS,
];

export const HELP_MODULES: string[] = [...new Set(HELP_TOPICS.map((t) => t.module))];

// The topic for the page you're on: the longest topic path that the current route starts with.
export function topicForPath(pathname: string): HelpTopic | undefined {
  return HELP_TOPICS.filter((t) => pathname === t.path || pathname.startsWith(t.path.endsWith("/") ? t.path : `${t.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

export function topicById(id: string | undefined): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface HelpSearchResult {
  topic: HelpTopic;
  howTos: HowTo[]; // how-tos that match the words, shown first
  score: number;
}

// Plain word search over titles, keywords, summaries, sections and how-to steps. Every word must
// appear somewhere in the topic; title and keyword hits rank highest.
export function searchHelp(query: string): HelpSearchResult[] {
  const words = norm(query).split(" ").filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const results: HelpSearchResult[] = [];
  for (const topic of HELP_TOPICS) {
    const fields: [string, number][] = [
      [`${topic.title} ${topic.module}`, 6],
      [(topic.keywords ?? []).join(" "), 4],
      [topic.summary, 2],
      [(topic.sections ?? []).flatMap((s) => [s.title, ...s.items]).join(" "), 1],
      [(topic.howTos ?? []).map((h) => h.title).join(" "), 3],
      [(topic.howTos ?? []).flatMap((h) => h.steps.map((s) => s.text)).join(" "), 1],
    ];
    let score = 0;
    let all = true;
    for (const w of words) {
      const hit = fields.reduce((sum, [text, weight]) => sum + (norm(text).includes(w) ? weight : 0), 0);
      if (hit === 0) all = false;
      score += hit;
    }
    if (!all) continue;
    const howTos = (topic.howTos ?? []).filter((h) => words.every((w) => norm(`${h.title} ${h.steps.map((s) => s.text).join(" ")}`).includes(w)));
    results.push({ topic, howTos, score: score + howTos.length * 3 });
  }
  return results.sort((a, b) => b.score - a.score);
}

// ---- finding what a step points at, by its visible label

const HELP_UI = "[data-help-ui]";

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !el.closest(HELP_UI);
}

function pick(candidates: Element[], label: string): HTMLElement | null {
  const want = norm(label);
  const text = (el: Element) => norm(el.textContent ?? "");
  const shown = candidates.filter(visible);
  return (
    (shown.find((el) => text(el) === want) as HTMLElement | undefined) ??
    (shown.find((el) => text(el).startsWith(want)) as HTMLElement | undefined) ??
    null
  );
}

export function findTarget(target: HelpTarget): HTMLElement | null {
  const all = (selector: string) => Array.from(document.querySelectorAll(selector));
  switch (target.kind) {
    case "button":
      return pick(all("button, a.ep-btn, [role='button'], [role='menuitem']"), target.label);
    case "tab":
      return pick(all(".ep-tabs a, .ep-tabs button, [role='tab']"), target.label);
    case "nav":
      return pick(all(".ep-sb a, .ep-sb button"), target.label);
    case "field": {
      const label = pick(all("label, .ep-label"), target.label);
      if (!label) return null;
      const forId = label.getAttribute("for");
      const control = (forId && document.getElementById(forId)) || label.closest(".ep-field")?.querySelector("input, select, textarea");
      return (control as HTMLElement | null) ?? label;
    }
    case "text": {
      // The innermost visible element whose own text starts with the label.
      const want = norm(target.label);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let fallback: HTMLElement | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || !visible(el)) continue;
        const own = norm(node.textContent ?? "");
        if (own === want) return el;
        if (!fallback && own.startsWith(want)) fallback = el;
      }
      return fallback;
    }
  }
}
