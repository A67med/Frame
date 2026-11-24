export type FontPairId =
  | "jura-inter"
  | "sentient-switzer"
  | "fraunces-inter"
  | "general-sans"
  | "cabinet-switzer"
  | "plex"
  | "plus-jakarta"
  | "system";

export type FontPair = {
  id: FontPairId;
  name: string;
  blurb: string;
  display: string;
  sans: string;
};

export const FONT_PAIRS: Record<FontPairId, FontPair> = {
  "jura-inter": {
    id: "jura-inter",
    name: "Jura + Inter",
    blurb: "Geometric cinema titles, readable everyday text.",
    display: '"Jura", "Inter", system-ui, sans-serif',
    sans: '"Inter", system-ui, sans-serif',
  },
  "sentient-switzer": {
    id: "sentient-switzer",
    name: "Sentient + Switzer",
    blurb: "Default. Humanist serif, warm sans.",
    display: '"Sentient", "Iowan Old Style", "Georgia", serif',
    sans: '"Switzer", "Inter", system-ui, sans-serif',
  },
  "fraunces-inter": {
    id: "fraunces-inter",
    name: "Fraunces + Inter",
    blurb: "Classic. Was Frame's original pair.",
    display: '"Fraunces", "Iowan Old Style", "Georgia", serif',
    sans: '"Inter", system-ui, sans-serif',
  },
  "general-sans": {
    id: "general-sans",
    name: "General Sans",
    blurb: "Clean modern. Sans across the board.",
    display: '"General Sans", "Inter", system-ui, sans-serif',
    sans: '"General Sans", "Inter", system-ui, sans-serif',
  },
  "cabinet-switzer": {
    id: "cabinet-switzer",
    name: "Cabinet Grotesk + Switzer",
    blurb: "Editorial. Headline-strong display.",
    display: '"Cabinet Grotesk", "Inter", system-ui, sans-serif',
    sans: '"Switzer", "Inter", system-ui, sans-serif',
  },
  plex: {
    id: "plex",
    name: "IBM Plex",
    blurb: "Technical. IBM's open family.",
    display: '"IBM Plex Sans", system-ui, sans-serif',
    sans: '"IBM Plex Sans", system-ui, sans-serif',
  },
  "plus-jakarta": {
    id: "plus-jakarta",
    name: "Plus Jakarta Sans",
    blurb: "Stremio's typeface. Geometric humanist sans.",
    display: '"Plus Jakarta Sans", "Inter", system-ui, sans-serif',
    sans: '"Plus Jakarta Sans", "Inter", system-ui, sans-serif',
  },
  system: {
    id: "system",
    name: "System UI",
    blurb: "Whatever your OS uses.",
    display: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
};
