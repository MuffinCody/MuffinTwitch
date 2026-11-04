/** 7TV EventAPI (eine WebSocket-Verbindung) + Kosmetik (Paints/Namensfarben, Badges). */
import type { CSSProperties } from "react";

type Condition = Record<string, string>;
type Dispatch = (type: string, body: any) => void;

class SevenTvEventApi {
  private ws: WebSocket | null = null;
  private subs = new Map<string, { type: string; condition: Condition }>();
  private handlers = new Set<Dispatch>();
  private retry = 0;

  onDispatch(h: Dispatch) {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }

  subscribe(type: string, condition: Condition) {
    const key = `${type}|${JSON.stringify(condition)}`;
    if (this.subs.has(key)) return;
    this.subs.set(key, { type, condition });
    if (!this.ws) this.connect();
    else if (this.ws.readyState === WebSocket.OPEN) this.send(35, type, condition);
  }

  unsubscribe(type: string, condition: Condition) {
    const key = `${type}|${JSON.stringify(condition)}`;
    if (!this.subs.delete(key)) return;
    if (this.ws?.readyState === WebSocket.OPEN) this.send(36, type, condition);
  }

  private send(op: 35 | 36, type: string, condition: Condition) {
    this.ws?.send(JSON.stringify({ op, d: { type, condition } }));
  }

  private connect() {
    const ws = new WebSocket("wss://events.7tv.io/v3");
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      for (const s of this.subs.values()) this.send(35, s.type, s.condition);
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.op === 4) {
        ws.close();
        return;
      }
      if (msg.op !== 0 || !msg.d?.type) return;
      for (const h of this.handlers) {
        try {
          h(msg.d.type, msg.d.body);
        } catch (e) {
          console.warn("7TV", e);
        }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.subs.size) return;
      const delay = Math.min(30000, 1000 * 2 ** this.retry++);
      window.setTimeout(() => !this.ws && this.subs.size && this.connect(), delay);
    };
  }
}

export const stvEvents = new SevenTvEventApi();

// ---------- Kosmetik ----------
export interface StvBadge {
  title: string;
  url: string;
  srcset: string;
}

const paints = new Map<string, CSSProperties>();
const badges = new Map<string, StvBadge>();
const userPaint = new Map<string, string>(); // Twitch-User-ID → Paint-ID
const userBadge = new Map<string, string>(); // Twitch-User-ID → Badge-ID
const listeners = new Set<() => void>();
let scheduled = false;

export function onCosmeticsChanged(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function changed() {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    scheduled = false;
    listeners.forEach((l) => l());
  }, 1200);
}

export function paintFor(twitchUserId?: string): CSSProperties | undefined {
  if (!twitchUserId) return undefined;
  const id = userPaint.get(twitchUserId);
  return id ? paints.get(id) : undefined;
}

export function stvBadgeFor(twitchUserId?: string): StvBadge | undefined {
  if (!twitchUserId) return undefined;
  const id = userBadge.get(twitchUserId);
  return id ? badges.get(id) : undefined;
}

/** 7TV speichert Farben als vorzeichenbehaftete RGBA-Ganzzahl. */
function rgba(c: number | null | undefined): string {
  if (c === null || c === undefined) return "transparent";
  const n = c >>> 0;
  return `rgba(${(n >>> 24) & 255}, ${(n >>> 16) & 255}, ${(n >>> 8) & 255}, ${((n & 255) / 255).toFixed(3)})`;
}

function layerCss(l: any): string | null {
  const stops = (l.stops ?? []).map((s: any) => `${rgba(s.color)} ${Math.round(s.at * 1000) / 10}%`).join(", ");
  const rep = l.repeat ? "repeating-" : "";
  switch (l.function) {
    case "LINEAR_GRADIENT":
      return stops ? `${rep}linear-gradient(${l.angle ?? 90}deg, ${stops})` : null;
    case "RADIAL_GRADIENT":
      return stops ? `${rep}radial-gradient(${l.shape || "circle"}, ${stops})` : null;
    case "URL":
      return l.image_url ? `url("${l.image_url}")` : null;
    default:
      return null;
  }
}

function paintCss(d: any): CSSProperties {
  const layers: any[] = Array.isArray(d.gradients) && d.gradients.length ? d.gradients : [d];
  const images = layers.map(layerCss).filter(Boolean) as string[];
  const shadows = (d.shadows ?? [])
    .map((s: any) => `drop-shadow(${s.x_offset}px ${s.y_offset}px ${s.radius}px ${rgba(s.color)})`)
    .join(" ");
  if (!images.length) return d.color != null ? { color: rgba(d.color) } : {};
  const isUrl = layers.some((l) => l.function === "URL");
  return {
    backgroundImage: images.join(", "),
    backgroundSize: isUrl ? "cover" : "100% 100%",
    backgroundColor: d.color != null ? rgba(d.color) : undefined,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent",
    filter: shadows || undefined,
  };
}

function twitchIdOf(entitlement: any): string | undefined {
  return entitlement?.user?.connections?.find((c: any) => c.platform === "TWITCH")?.id;
}

stvEvents.onDispatch((type, body) => {
  const o = body?.object;
  if (!o) return;
  if (type === "cosmetic.create") {
    if (o.kind === "PAINT" && o.data) paints.set(o.id, paintCss(o.data));
    if (o.kind === "BADGE" && o.data?.host?.url) {
      const base = `https:${o.data.host.url}`;
      badges.set(o.id, {
        title: o.data.tooltip || o.data.name || "7TV",
        url: `${base}/1x.webp`,
        srcset: `${base}/1x.webp 1x, ${base}/2x.webp 2x, ${base}/3x.webp 3x`,
      });
    }
    changed();
  } else if (type === "entitlement.create") {
    const tid = twitchIdOf(o);
    if (!tid) return;
    if (o.kind === "PAINT") userPaint.set(tid, o.ref_id);
    if (o.kind === "BADGE") userBadge.set(tid, o.ref_id);
    changed();
  } else if (type === "entitlement.delete") {
    const tid = twitchIdOf(o);
    if (!tid) return;
    if (o.kind === "PAINT" && userPaint.get(tid) === o.ref_id) userPaint.delete(tid);
    if (o.kind === "BADGE" && userBadge.get(tid) === o.ref_id) userBadge.delete(tid);
    changed();
  }
});

/** Kosmetik-Events für alle Nutzer in diesem Kanal abonnieren. */
export function subscribeChannelCosmetics(roomId: string) {
  const cond = { platform: "TWITCH", ctx: "channel", id: roomId };
  stvEvents.subscribe("cosmetic.*", cond);
  stvEvents.subscribe("entitlement.*", cond);
}

export function unsubscribeChannelCosmetics(roomId: string) {
  const cond = { platform: "TWITCH", ctx: "channel", id: roomId };
  stvEvents.unsubscribe("cosmetic.*", cond);
  stvEvents.unsubscribe("entitlement.*", cond);
}

// ---------- Eigene Präsenz (damit dein Paint auch bei dir/anderen erscheint) ----------
let selfStvId: string | null = null;
const lastPresence = new Map<string, number>();

export async function setSelfUser(twitchUserId: string | null) {
  selfStvId = null;
  if (!twitchUserId) return;
  try {
    const r = await fetch(`https://7tv.io/v3/users/twitch/${twitchUserId}`);
    if (r.ok) selfStvId = (await r.json())?.user?.id ?? null;
  } catch {
    /* kein 7TV-Konto */
  }
}

export function sendPresence(roomId: string | undefined, force = false) {
  if (!selfStvId || !roomId) return;
  const now = Date.now();
  if (!force && now - (lastPresence.get(roomId) ?? 0) < 60_000) return;
  lastPresence.set(roomId, now);
  fetch(`https://7tv.io/v3/users/${selfStvId}/presences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: 1, passive: false, data: { platform: "TWITCH", id: roomId } }),
  }).catch(() => {});
}
