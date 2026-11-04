import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSettings } from "./settings";

export interface PointsState {
  balance?: number;
  channelId?: string;
  /** Wartende Bonus-Truhe (wenn Auto-Einsammeln aus ist) */
  claimId?: string;
  claimedCount: number;
  error?: string;
}

const POLL_MS = 60_000;

class PointsManager {
  private state = new Map<string, PointsState>();
  private channels: string[] = [];
  private enabled = false;
  private timer: number | undefined;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getVersion = () => this.version;

  get(channel: string): PointsState | undefined {
    return this.enabled ? this.state.get(channel) : undefined;
  }

  private notify() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  setChannels(channels: string[], enabled: boolean) {
    const added = channels.filter((c) => !this.channels.includes(c));
    const changed = enabled !== this.enabled;
    this.channels = channels;
    this.enabled = enabled;
    for (const k of [...this.state.keys()]) if (!channels.includes(k)) this.state.delete(k);
    window.clearInterval(this.timer);
    this.timer = undefined;
    if (!enabled) {
      this.notify();
      return;
    }
    this.timer = window.setInterval(() => this.pollAll(), POLL_MS);
    (changed ? channels : added).forEach((c, i) => window.setTimeout(() => this.poll(c), i * 400));
  }

  private pollAll() {
    this.channels.forEach((c, i) => window.setTimeout(() => this.poll(c), i * 500));
  }

  async poll(channel: string) {
    if (!this.enabled) return;
    const st = this.state.get(channel) ?? { claimedCount: 0 };
    try {
      const r = await invoke<{ channel_id: string; balance: number | null; claim_id: string | null }>(
        "channel_points",
        { login: channel },
      );
      st.channelId = r.channel_id;
      st.balance = r.balance ?? undefined;
      st.claimId = r.claim_id ?? undefined;
      if (!this.blocked) st.error = undefined;
      this.state.set(channel, st);
      if (st.claimId && getSettings().autoClaimPoints && !this.blocked) await this.claim(channel);
    } catch (e) {
      st.error = String(e);
      this.state.set(channel, st);
    }
    this.notify();
  }

  async claim(channel: string) {
    const st = this.state.get(channel);
    if (!st?.channelId || !st.claimId) return;
    try {
      await invoke("claim_points", { channelId: st.channelId, claimId: st.claimId });
      st.claimId = undefined;
      st.claimedCount++;
      this.notify();
      window.setTimeout(() => this.poll(channel), 1500);
    } catch (e) {
      st.error = String(e);
      // Twitch verlangt den Integritäts-Nachweis seiner eigenen Webseite → keine weiteren Auto-Versuche
      if (isIntegrityError(st.error)) this.blocked = true;
      this.notify();
    }
  }

  /** Twitch blockiert Einsammeln außerhalb der eigenen Webseite */
  blocked = false;

  /** Offiziellen Twitch-Chat (Popout) des Kanals im Standard-Browser öffnen – dort Truhe/Belohnungen nutzen */
  openTwitchChat(channel: string) {
    return openUrl(`https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat?popout=`);
  }
}

export function isIntegrityError(msg: string | undefined | null) {
  return !!msg && /integrity/i.test(msg);
}

export const points = new PointsManager();

export function usePoints(channel: string | undefined): PointsState | undefined {
  useSyncExternalStore(points.subscribe, points.getVersion);
  return channel ? points.get(channel) : undefined;
}

export function formatPoints(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")} Mio.`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(".0", "")}K`;
  return n.toLocaleString("de-DE");
}
