import { getSettings } from "./settings";
import { t } from "./i18n";

export type PlayerAction =
  | "playPause"
  | "mute"
  | "fullscreen"
  | "chat"
  | "volumeUp"
  | "volumeDown"
  | "live"
  | "reload"
  | "nextStream";

/** Reihenfolge + Beschriftung (deutscher Text = Übersetzungs-Schlüssel) */
export const SHORTCUT_ACTIONS: { id: PlayerAction; label: string }[] = [
  { id: "playPause", label: "Abspielen / Pause" },
  { id: "mute", label: "Stumm schalten" },
  { id: "fullscreen", label: "Vollbild" },
  { id: "chat", label: "Chat ein-/ausblenden" },
  { id: "volumeUp", label: "Lauter" },
  { id: "volumeDown", label: "Leiser" },
  { id: "live", label: "Zur Live-Kante springen" },
  { id: "reload", label: "Stream neu laden" },
  { id: "nextStream", label: "Multiview: Ton zum nächsten Stream" },
];

export const DEFAULT_SHORTCUTS: Record<PlayerAction, string> = {
  playPause: "Space",
  mute: "M",
  fullscreen: "F",
  chat: "C",
  volumeUp: "ArrowUp",
  volumeDown: "ArrowDown",
  live: "L",
  reload: "R",
  nextStream: "N",
};

/** Taste eines Tastatur-Ereignisses als speicherbarer Name ("M", "Space", "ArrowUp", "F5" …) */
export function keyName(e: KeyboardEvent): string {
  if (e.key === " " || e.code === "Space") return "Space";
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key;
}

/** Tasten, die nicht belegt werden können */
export const RESERVED_KEYS = new Set(["Escape", "Tab", "Enter", "Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Unidentified"]);

const ARROWS: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

const KEY_LABELS: Record<string, string> = {
  Space: "Leertaste",
  PageUp: "Bild ↑",
  PageDown: "Bild ↓",
  Home: "Pos1",
  End: "Ende",
  Insert: "Einfg",
  Delete: "Entf",
  Backspace: "Rücktaste",
};

export function keyLabel(k: string) {
  if (!k) return "–";
  if (ARROWS[k]) return ARROWS[k];
  const l = KEY_LABELS[k];
  return l ? t(l) : k;
}

export function currentShortcuts(): Record<PlayerAction, string> {
  return { ...DEFAULT_SHORTCUTS, ...getSettings().shortcuts };
}

/** Welche Aktion gehört zu dieser Taste? */
export function actionForKey(k: string): PlayerAction | undefined {
  const map = currentShortcuts();
  return SHORTCUT_ACTIONS.find((a) => map[a.id] === k)?.id;
}

/** Ereignis kommt aus einem Eingabefeld → Tastenkürzel nicht auslösen */
export function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// ---------- Befehle an einen bestimmten Player ----------
type Handler = (login: string, action: PlayerAction) => void;
const handlers = new Set<Handler>();

export const playerBus = {
  on(h: Handler) {
    handlers.add(h);
    return () => {
      handlers.delete(h);
    };
  },
  emit(login: string, action: PlayerAction) {
    handlers.forEach((h) => h(login, action));
  },
};
