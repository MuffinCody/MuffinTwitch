import { findEmote, twitchEmote, type Emote } from "./emotes";

export type Token =
  | { t: "text"; v: string }
  | { t: "emote"; e: Emote; overlays: Emote[] }
  | { t: "link"; v: string; href: string }
  | { t: "mention"; v: string };

const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/** Zerlegt eine Nachricht in Text, Emotes (Twitch + 7TV/BTTV/FFZ), Links und Erwähnungen. */
export function tokenize(channel: string, text: string, emoteTag?: string): Token[] {
  // Twitch-Emote-Positionen sind in Unicode-Codepoints angegeben
  const chars = Array.from(text);
  const ranges: { start: number; end: number; id: string }[] = [];
  if (emoteTag) {
    for (const part of emoteTag.split("/")) {
      const [id, pos] = part.split(":");
      if (!pos) continue;
      for (const r of pos.split(",")) {
        const [s, e] = r.split("-").map(Number);
        if (!Number.isNaN(s) && !Number.isNaN(e)) ranges.push({ start: s, end: e, id });
      }
    }
    ranges.sort((a, b) => a.start - b.start);
  }

  const out: Token[] = [];
  const pushEmote = (e: Emote) => {
    const prev = out[out.length - 1];
    if (e.zeroWidth && prev?.t === "emote") {
      prev.overlays.push(e);
      return;
    }
    // Leerzeichen zwischen Emote und Zero-Width-Emote überspringen
    out.push({ t: "emote", e, overlays: [] });
  };

  const pushWords = (segment: string) => {
    const parts = segment.split(/(\s+)/);
    for (const w of parts) {
      if (!w) continue;
      if (/^\s+$/.test(w)) {
        // Leerzeichen vor Zero-Width-Emote nicht anzeigen
        out.push({ t: "text", v: w });
        continue;
      }
      const em = findEmote(channel, w);
      if (em) {
        if (em.zeroWidth) {
          // Whitespace vor Overlay entfernen
          const last = out[out.length - 1];
          if (last?.t === "text" && /^\s+$/.test(last.v) && out[out.length - 2]?.t === "emote") out.pop();
        }
        pushEmote(em);
      } else if (w.startsWith("@") && w.length > 1) {
        out.push({ t: "mention", v: w });
      } else if (URL_RE.test(w)) {
        out.push({ t: "link", v: w, href: /^https?:\/\//i.test(w) ? w : `https://${w}` });
      } else {
        const last = out[out.length - 1];
        if (last?.t === "text") last.v += w;
        else out.push({ t: "text", v: w });
      }
    }
  };

  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue;
    if (r.start > cursor) pushWords(chars.slice(cursor, r.start).join(""));
    const name = chars.slice(r.start, r.end + 1).join("");
    pushEmote(twitchEmote(r.id, name));
    cursor = r.end + 1;
  }
  if (cursor < chars.length) pushWords(chars.slice(cursor).join(""));
  return out;
}

// ---------- Namensfarben (lesbar auf dunklem Hintergrund) ----------
const DEFAULT_COLORS = [
  "#FF4A4A", "#4A7CFF", "#2ECC71", "#B22222", "#FF7F50", "#9ACD32", "#FF4500",
  "#2E8B57", "#DAA520", "#D2691E", "#5F9EA0", "#1E90FF", "#FF69B4", "#8A2BE2", "#00FF7F",
];
const colorCache = new Map<string, string>();

export function nameColor(login: string, color?: string): string {
  const key = `${login}|${color ?? ""}`;
  const cached = colorCache.get(key);
  if (cached) return cached;
  let c = color;
  if (!c) {
    let h = 0;
    for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) | 0;
    c = DEFAULT_COLORS[Math.abs(h) % DEFAULT_COLORS.length];
  }
  const out = readable(c);
  colorCache.set(key, out);
  return out;
}

function readable(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  if (l >= 0.5) return hex;
  l = Math.min(0.75, l + (0.5 - l) * 0.9 + 0.08);
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}
