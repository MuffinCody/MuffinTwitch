import { useSyncExternalStore } from "react";

export interface Settings {
  chatFontSize: number;
  showTimestamps: boolean;
  chatWidth: number;
  sidebarOpen: boolean;
  /** Im Multiview nur den ausgewählten Stream hörbar machen */
  audioFocus: boolean;
  /** Niedrige Latenz (aggressiveres Aufholen) */
  lowLatency: boolean;
  defaultQuality: "auto" | "source";
  favorites: string[];
  volume: number;
  emoteScale: number;
  chatOpen: boolean;
  /** Zuletzt geöffnete Kanäle (werden beim Start wiederhergestellt) */
  lastChannels: string[];

  // Chat-Darstellung
  chatFontFamily: string;
  chatLineSpacing: number;
  chatAltRows: boolean;
  showBadges: boolean;
  show7tvPaints: boolean;
  // Chat-Verhalten
  mentionSound: boolean;
  mentionVolume: number;
  /** Zusätzliche Wörter, die wie eine Erwähnung markiert werden (kommagetrennt) */
  highlightWords: string;
  /** Nachrichten um X Sekunden verzögern (z. B. passend zur Stream-Verzögerung) */
  chatDelay: number;
  /** Max. neue Nachrichten pro Sekunde (0 = unbegrenzt) */
  chatMaxRate: number;
  pauseOnHover: boolean;
  /** Beim Öffnen die letzten Nachrichten laden (recent-messages.robotty.de) */
  loadChatHistory: boolean;
  /** Im Nutzer-Fenster ältere Nachrichten aus öffentlichen Logs laden (logs.ivr.fi) */
  loadUserLogs: boolean;

  autoClaimPoints: boolean;
  /** Fertige Drops automatisch einsammeln */
  autoClaimDrops: boolean;
  browseLanguage: string;

  /** Sortierung der gefolgten Live-Kanäle */
  followSort: "viewers" | "recent" | "recommended";
  /** Lokale Zuschau-Statistik pro Kanal (für "Zuletzt gesehen" / "Empfohlen") */
  watchStats: Record<string, { last: number; minutes: number }>;
  /** Lieblingskategorien */
  favGames: { id: string; name: string; box_art_url: string }[];
  /** Kategorien in der Seitenleiste: Top oder nur Favoriten */
  categoryFilter: "top" | "fav";
}

const DEFAULTS: Settings = {
  chatFontSize: 14,
  showTimestamps: false,
  chatWidth: 340,
  sidebarOpen: true,
  audioFocus: true,
  lowLatency: true,
  defaultQuality: "auto",
  favorites: [],
  volume: 0.6,
  emoteScale: 1,
  chatOpen: true,
  lastChannels: [],
  chatFontFamily: "Segoe UI",
  chatLineSpacing: 1.6,
  chatAltRows: false,
  showBadges: true,
  show7tvPaints: true,
  mentionSound: true,
  mentionVolume: 0.5,
  highlightWords: "",
  chatDelay: 0,
  chatMaxRate: 0,
  pauseOnHover: false,
  loadChatHistory: true,
  loadUserLogs: true,
  autoClaimPoints: true,
  autoClaimDrops: true,
  browseLanguage: "",
  followSort: "viewers",
  watchStats: {},
  favGames: [],
  categoryFilter: "top",
};

/** Merkt, dass ein Kanal gerade geschaut wird (+ Minuten). */
export function recordWatch(login: string, minutes = 0) {
  const prev = current.watchStats[login] ?? { last: 0, minutes: 0 };
  updateSettings({
    watchStats: { ...current.watchStats, [login]: { last: Date.now(), minutes: prev.minutes + minutes } },
  });
}

export function toggleFavGame(g: { id: string; name: string; box_art_url: string }) {
  const has = current.favGames.some((x) => x.id === g.id);
  updateSettings({
    favGames: has
      ? current.favGames.filter((x) => x.id !== g.id)
      : [...current.favGames, { id: g.id, name: g.name, box_art_url: g.box_art_url }],
  });
}

export const CHAT_FONTS = [
  "Segoe UI",
  "Inter",
  "Roboto",
  "Arial",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Calibri",
  "Consolas",
  "Comic Sans MS",
];

const KEY = "nativ.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
