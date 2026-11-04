import { api } from "./api";

export interface Badge {
  title: string;
  url: string;
  srcset: string;
}

type BadgeMap = Map<string, Badge>; // "set/version" -> Badge

const globalBadges: BadgeMap = new Map();
const channelBadges = new Map<string, BadgeMap>(); // roomId -> map
let globalLoaded = false;

function toMap(data: any[], into: BadgeMap) {
  for (const set of data ?? []) {
    for (const v of set.versions ?? []) {
      into.set(`${set.set_id}/${v.id}`, {
        title: v.title || set.set_id,
        url: v.image_url_1x,
        srcset: `${v.image_url_1x} 1x, ${v.image_url_2x} 2x, ${v.image_url_4x} 4x`,
      });
    }
  }
}

/** Badges brauchen die Helix-API → nur mit Login verfügbar. */
export async function loadGlobalBadges() {
  if (globalLoaded) return;
  try {
    const r = await api.helix<{ data: any[] }>("chat/badges/global");
    toMap(r.data, globalBadges);
    globalLoaded = true;
  } catch {
    /* nicht angemeldet */
  }
}

export async function loadChannelBadges(roomId: string) {
  if (channelBadges.has(roomId)) return;
  try {
    const r = await api.helix<{ data: any[] }>("chat/badges", [["broadcaster_id", roomId]]);
    const m: BadgeMap = new Map();
    toMap(r.data, m);
    channelBadges.set(roomId, m);
  } catch {
    /* ignore */
  }
}

export function findBadge(roomId: string | undefined, set: string, version: string): Badge | undefined {
  const key = `${set}/${version}`;
  return (roomId ? channelBadges.get(roomId)?.get(key) : undefined) ?? globalBadges.get(key);
}

export function resetBadges() {
  globalLoaded = false;
  globalBadges.clear();
  channelBadges.clear();
}
