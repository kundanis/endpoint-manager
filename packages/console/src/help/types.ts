// Help Center content model. Each topic describes one console page (matched by route), its
// tabs and features, and step-by-step how-tos. A step can point at something on screen by its
// visible label ("Show me" highlights it), so the help needs no hooks inside the pages.

export type HelpTargetKind =
  | "button" // a button or button-styled link, matched by its text
  | "tab" // a page tab (route tabs or in-page tabs)
  | "field" // a form control, matched by its label
  | "nav" // a sidebar module or menu item
  | "text"; // any element whose own text matches

export interface HelpTarget {
  kind: HelpTargetKind;
  label: string;
}

export interface HelpStep {
  text: string;
  target?: HelpTarget;
  // Open this page before the step (the first step of a how-to usually has one).
  route?: string;
}

export interface HowTo {
  id: string;
  title: string;
  steps: HelpStep[];
}

export interface HelpSection {
  title: string;
  items: string[];
}

export interface HelpTopic {
  id: string;
  module: string; // sidebar module, e.g. "Endpoint Hub"
  title: string; // page name, e.g. "Endpoints"
  path: string; // console route the topic belongs to
  summary: string;
  sections?: HelpSection[];
  howTos?: HowTo[];
  keywords?: string[]; // extra search words
  superAdminOnly?: boolean; // the page is for super admins; hidden from other admins' help
}
