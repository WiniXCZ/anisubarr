// Translation dictionary for the admin UI. Base languages: Czech (cs, source
// language), Slovak (sk), English (en). Being filled in incrementally page by
// page — see individual page files for which ones currently use t() vs. are
// still hardcoded Czech. Anime synopses/descriptions are AI-translated data
// content, not UI chrome, and are deliberately NOT part of this dictionary.
//
// Each language lives in its own locales/<code>.yaml file (flat key: value
// pairs — same keys across all files). Loaded here as raw text via Vite's
// `?raw` import suffix and parsed with js-yaml at module-init time.
//
// Adding a new language later = add locales/<code>.yaml with the same keys
// as cs.yaml, import it below, add it to TRANSLATIONS and LANGUAGE_OPTIONS.

// js-yaml v5 ships as ESM with only named exports (no default export) —
// import { load } directly rather than `import yaml from "js-yaml"`.
import { load } from "js-yaml";
import csRaw from "./locales/cs.yaml?raw";
import skRaw from "./locales/sk.yaml?raw";
import enRaw from "./locales/en.yaml?raw";

const cs = load(csRaw);
const sk = load(skRaw);
const en = load(enRaw);

export const TRANSLATIONS = { cs, sk, en };

export const LANGUAGE_OPTIONS = [
  { value: "cs", label: "Čeština" },
  { value: "sk", label: "Slovenčina" },
  { value: "en", label: "English" },
];
