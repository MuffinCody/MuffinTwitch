/**
 * Mini-Übersetzung: Der deutsche Text ist der Schlüssel, für Englisch gibt es ein Wörterbuch.
 * Platzhalter in geschweiften Klammern: t("{n} Zuschauer", { n: 5 }).
 */
import { useSyncExternalStore } from "react";
import { getSettings, subscribeSettings } from "./settings";
import { EN } from "../i18n/en";

export type Lang = "de" | "en";

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "de", label: "Deutsch" },
  { id: "en", label: "English" },
];

export function currentLang(): Lang {
  return getSettings().language === "en" ? "en" : "de";
}

/** Gebietsschema für Datum/Zahlen */
export function locale(): string {
  return currentLang() === "en" ? "en-US" : "de-DE";
}

const missing = new Set<string>();

export function t(de: string, vars?: Record<string, string | number>): string {
  let s = de;
  if (currentLang() === "en") {
    const en = EN[de];
    if (en !== undefined) s = en;
    else if (import.meta.env.DEV && !missing.has(de)) {
      missing.add(de);
      (window as any).__i18nMissing = [...missing];
      console.debug("[i18n] fehlt:", de);
    }
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
  return s;
}

/** Hook: Komponente zeichnet sich neu, wenn die Sprache wechselt (nur dann). */
export function useT() {
  useSyncExternalStore(subscribeSettings, currentLang);
  return t;
}

/** Sprache beim ersten Start aus Windows/Browser ableiten */
export function detectLang(): Lang {
  return (navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en";
}
