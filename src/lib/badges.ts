import { twitchApi } from "./api";

export interface Badge {
  title: string;
  url: string;
  srcset: string;
}

type BadgeMap = Map<string, Badge>; // "set/version" -> Badge

const globalBadges: BadgeMap = new Map();
const channelBadges = new Map<string, BadgeMap>(); // roomId -> map
let globalLoaded = false;

function toMap(list: { setID: string; version: string; title: string; imageURL: string }[], into: BadgeMap) {
  for (const b of list) {
    if (!b.imageURL) continue;
    // ".../badges/v1/<id>/1" → Größen 1, 2, 3
    const base = b.imageURL.replace(/\/\d+$/, "");
    into.set(`${b.setID}/${b.version}`, {
      title: b.title || b.setID,
      url: `${base}/1`,
      srcset: `${base}/1 1x, ${base}/2 2x, ${base}/3 4x`,
    });
  }
}

export async function loadGlobalBadges() {
  if (globalLoaded) return;
  try {
    toMap(await twitchApi.badges(), globalBadges);
    globalLoaded = true;
  } catch {
    /* später erneut */
  }
}

export async function loadChannelBadges(roomId: string) {
  if (channelBadges.has(roomId)) return;
  try {
    const m: BadgeMap = new Map();
    toMap(await twitchApi.badges(roomId), m);
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
