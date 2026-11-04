import { stvEvents } from "./seventv";
import { t } from "./i18n";
/** Drittanbieter-Emotes: 7TV (inkl. Live-Updates), BTTV, FFZ. */

export type Provider = "twitch" | "7tv" | "bttv" | "ffz";

export interface Emote {
  id: string;
  name: string;
  provider: Provider;
  url: string;
  srcset: string;
  zeroWidth: boolean;
  width?: number;
  height?: number;
}

type EmoteMap = Map<string, Emote>;

const globalEmotes: EmoteMap = new Map();
const channelEmotes = new Map<string, EmoteMap>();
const listeners = new Set<(channel: string | null) => void>();
const BTTV_ZERO_WIDTH = new Set([
  "SoSnowy", "IceCold", "SantaHat", "TopHat", "ReinDeer", "CandyCane", "cvMask", "cvHazmat",
]);

export function onEmotesChanged(cb: (channel: string | null) => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
let emoteVer = 0;
/** Steigt bei jeder Änderung an geladenen Emotes (für Token-Cache im Chat) */
export const emoteVersion = () => emoteVer;
const notify = (channel: string | null) => {
  emoteVer++;
  listeners.forEach((l) => l(channel));
};

export function findEmote(channel: string, word: string): Emote | undefined {
  return channelEmotes.get(channel)?.get(word) ?? globalEmotes.get(word);
}

export function emoteNames(channel: string): string[] {
  const names = new Set<string>(globalEmotes.keys());
  channelEmotes.get(channel)?.forEach((_, k) => names.add(k));
  return [...names];
}

/** Für den Emote-Picker */
export function channelEmoteList(channel: string): Emote[] {
  return [...(channelEmotes.get(channel)?.values() ?? [])];
}
export function globalEmoteList(): Emote[] {
  return [...globalEmotes.values()];
}

export function channelEmoteCount(channel: string) {
  return channelEmotes.get(channel)?.size ?? 0;
}

export function twitchEmote(id: string, name: string): Emote {
  const base = `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark`;
  return {
    id,
    name,
    provider: "twitch",
    url: `${base}/1.0`,
    srcset: `${base}/1.0 1x, ${base}/2.0 2x, ${base}/3.0 4x`,
    zeroWidth: false,
  };
}

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ---------- 7TV ----------
function seventvEmote(e: any): Emote | null {
  const host = e?.data?.host;
  if (!host?.url) return null;
  const base = `https:${host.url}`;
  const files: any[] = (host.files ?? []).filter((f: any) => f.format === "WEBP");
  const one = files.find((f) => f.name.startsWith("1x"));
  return {
    id: e.id,
    name: e.name,
    provider: "7tv",
    url: `${base}/1x.webp`,
    srcset: `${base}/1x.webp 1x, ${base}/2x.webp 2x, ${base}/4x.webp 4x`,
    zeroWidth: ((e.flags ?? 0) & 1) === 1 || ((e.data.flags ?? 0) & 256) === 256,
    width: one?.width,
    height: one?.height,
  };
}

// ---------- BTTV ----------
function bttvEmote(e: any): Emote {
  const base = `https://cdn.betterttv.net/emote/${e.id}`;
  return {
    id: e.id,
    name: e.code,
    provider: "bttv",
    url: `${base}/1x`,
    srcset: `${base}/1x 1x, ${base}/2x 2x, ${base}/3x 4x`,
    zeroWidth: BTTV_ZERO_WIDTH.has(e.code),
    width: e.width,
    height: e.height,
  };
}

// ---------- FFZ (über BTTV-Cache) ----------
function ffzEmote(e: any): Emote {
  const imgs = e.images ?? {};
  return {
    id: String(e.id),
    name: e.code,
    provider: "ffz",
    url: imgs["1x"],
    srcset: [imgs["1x"] && `${imgs["1x"]} 1x`, imgs["2x"] && `${imgs["2x"]} 2x`, imgs["4x"] && `${imgs["4x"]} 4x`]
      .filter(Boolean)
      .join(", "),
    zeroWidth: false,
  };
}

let globalLoaded: Promise<void> | null = null;

export function loadGlobalEmotes() {
  if (globalLoaded) return globalLoaded;
  globalLoaded = (async () => {
    const [ffz, bttv, stv] = await Promise.all([
      getJson("https://api.betterttv.net/3/cached/frankerfacez/emotes/global"),
      getJson("https://api.betterttv.net/3/cached/emotes/global"),
      getJson("https://7tv.io/v3/emote-sets/global"),
    ]);
    // Reihenfolge = Priorität (später überschreibt früher)
    (ffz ?? []).forEach((e: any) => globalEmotes.set(e.code, ffzEmote(e)));
    (bttv ?? []).forEach((e: any) => globalEmotes.set(e.code, bttvEmote(e)));
    (stv?.emotes ?? []).forEach((e: any) => {
      const em = seventvEmote(e);
      if (em) globalEmotes.set(em.name, em);
    });
    notify(null);
  })();
  return globalLoaded;
}

const loadedChannels = new Map<string, string>(); // channel -> roomId

export async function loadChannelEmotes(channel: string, roomId: string, force = false) {
  if (!force && loadedChannels.get(channel) === roomId) return;
  loadedChannels.set(channel, roomId);

  const [ffz, bttv, stv] = await Promise.all([
    getJson(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${roomId}`),
    getJson(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`),
    getJson(`https://7tv.io/v3/users/twitch/${roomId}`),
  ]);

  const map: EmoteMap = new Map();
  (ffz ?? []).forEach((e: any) => map.set(e.code, ffzEmote(e)));
  [...(bttv?.channelEmotes ?? []), ...(bttv?.sharedEmotes ?? [])].forEach((e: any) =>
    map.set(e.code, bttvEmote(e)),
  );
  (stv?.emote_set?.emotes ?? []).forEach((e: any) => {
    const em = seventvEmote(e);
    if (em) map.set(em.name, em);
  });
  channelEmotes.set(channel, map);
  notify(channel);

  const setId = stv?.emote_set?.id;
  if (setId) subscribeEmoteSet(channel, setId);
}

export function unloadChannelEmotes(channel: string) {
  loadedChannels.delete(channel);
  channelEmotes.delete(channel);
  unsubscribeEmoteSet(channel);
}

// ---------- 7TV EventAPI (Live-Updates des Emote-Sets) ----------
type EmoteUpdate = { channel: string; actor: string; added?: string; removed?: string; renamed?: [string, string] };
const updateListeners = new Set<(u: EmoteUpdate) => void>();
export function onSevenTvUpdate(cb: (u: EmoteUpdate) => void) {
  updateListeners.add(cb);
  return () => {
    updateListeners.delete(cb);
  };
}

const setSubs = new Map<string, string>(); // setId -> channel

function subscribeEmoteSet(channel: string, setId: string) {
  for (const [id, ch] of setSubs) if (ch === channel && id !== setId) unsubscribeEmoteSet(channel);
  setSubs.set(setId, channel);
  stvEvents.subscribe("emote_set.update", { object_id: setId });
}

function unsubscribeEmoteSet(channel: string) {
  for (const [id, ch] of [...setSubs]) {
    if (ch !== channel) continue;
    setSubs.delete(id);
    stvEvents.unsubscribe("emote_set.update", { object_id: id });
  }
}

stvEvents.onDispatch((type, body) => {
  if (type !== "emote_set.update") return;
  const channel = setSubs.get(body?.id);
  if (!channel) return;
  const map = channelEmotes.get(channel) ?? new Map();
  const actor = body.actor?.display_name ?? t("Jemand");
  const emit = (u: Omit<EmoteUpdate, "channel" | "actor">) =>
    updateListeners.forEach((l) => l({ channel, actor, ...u }));
  for (const p of body.pushed ?? []) {
    if (p.key !== "emotes" || !p.value) continue;
    const em = seventvEmote(p.value);
    if (em) {
      map.set(em.name, em);
      emit({ added: em.name });
    }
  }
  for (const p of body.pulled ?? []) {
    if (p.key !== "emotes" || !p.old_value) continue;
    map.delete(p.old_value.name);
    emit({ removed: p.old_value.name });
  }
  for (const p of body.updated ?? []) {
    if (p.key !== "emotes" || !p.value || !p.old_value) continue;
    map.delete(p.old_value.name);
    const em = seventvEmote(p.value);
    if (em) map.set(em.name, em);
    emit({ renamed: [p.old_value.name, p.value.name] });
  }
  channelEmotes.set(channel, map);
  notify(channel);
});