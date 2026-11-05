import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { twitchApi } from "./api";
import { isIntegrityError } from "./points";

/** Folge-Status pro Kanal-ID (undefined = noch unbekannt) */
const status = new Map<string, boolean>();
const busy = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let myId: string | null = null;
/** Wird nach erfolgreichem (Ent-)Folgen aufgerufen, z. B. um die Liste neu zu laden */
let onChanged: (() => void) | null = null;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

export function setFollowUser(userId: string | null, changed: () => void) {
  if (userId !== myId) {
    status.clear();
    notify();
  }
  myId = userId;
  onChanged = changed;
}

async function load(broadcasterId: string) {
  if (!myId || status.has(broadcasterId) || busy.has(broadcasterId)) return;
  busy.add(broadcasterId);
  try {
    status.set(broadcasterId, await twitchApi.isFollowing(myId, broadcasterId));
  } catch {
    /* unbekannt lassen */
  } finally {
    busy.delete(broadcasterId);
    notify();
  }
}

export type FollowResult = "ok" | "browser" | { error: string };

/** Folgen/Entfolgen. Blockiert Twitch das außerhalb der Webseite, wird der Kanal im Browser geöffnet. */
export async function toggleFollow(broadcasterId: string, login: string): Promise<FollowResult> {
  const follow = !status.get(broadcasterId);
  busy.add(broadcasterId);
  notify();
  try {
    await invoke("follow_channel", { targetId: broadcasterId, follow });
    status.set(broadcasterId, follow);
    window.setTimeout(() => onChanged?.(), 1500);
    return "ok";
  } catch (e) {
    const msg = String(e);
    if (isIntegrityError(msg)) {
      openUrl(`https://www.twitch.tv/${encodeURIComponent(login)}`).catch(() => {});
      // Status nach einer Weile neu abfragen (falls im Browser gefolgt wurde)
      window.setTimeout(() => {
        status.delete(broadcasterId);
        load(broadcasterId);
      }, 20_000);
      return "browser";
    }
    return { error: msg };
  } finally {
    busy.delete(broadcasterId);
    notify();
  }
}

export function useFollow(broadcasterId: string | undefined) {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => version,
  );
  useEffect(() => {
    if (broadcasterId) load(broadcasterId);
  }, [broadcasterId]);
  return {
    following: broadcasterId ? status.get(broadcasterId) : undefined,
    busy: broadcasterId ? busy.has(broadcasterId) : false,
    enabled: !!myId && !!broadcasterId,
  };
}
