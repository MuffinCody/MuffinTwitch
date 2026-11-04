import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export interface AuthInfo {
  client_id: string;
  logged_in: boolean;
  login: string | null;
  user_id: string | null;
  /** twitch.tv-Login aktiv → Turbo/Abo ohne Werbung */
  web: boolean;
  /** eigene App (Device Code) verbunden */
  app: boolean;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface HelixStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_name: string;
  title: string;
  viewer_count: number;
  started_at: string;
  thumbnail_url: string;
}

export interface HelixUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export const api = {
  getStreamUrl: (login: string) => invoke<string>("get_stream_url", { login }),
  authGet: () => invoke<AuthInfo>("auth_get"),
  authSetClientId: (clientId: string) => invoke<void>("auth_set_client_id", { clientId }),
  authStart: () => invoke<DeviceCode>("auth_start"),
  authPoll: (deviceCode: string) => invoke<"pending" | "ok">("auth_poll", { deviceCode }),
  authWebLogin: () => invoke<void>("auth_web_login"),
  authLogout: (which: "all" | "web" | "app" = "all") => invoke<void>("auth_logout", { which }),
  chatCredentials: () => invoke<{ login: string; token: string } | null>("auth_chat_credentials"),
  helix: <T = any>(path: string, query: [string, string][] = []) =>
    invoke<T>("helix", { path, query }),
  helixPost: <T = any>(path: string, query: [string, string][], body: unknown) =>
    invoke<T>("helix_post", { path, query, body }),
  logError: (message: string) => invoke<void>("log_error", { message }),
};

export interface HelixChannelSearch {
  id: string;
  broadcaster_login: string;
  display_name: string;
  thumbnail_url: string;
  is_live: boolean;
  game_name: string;
  title: string;
}

export interface HelixGame {
  id: string;
  name: string;
  box_art_url: string;
}

export function boxArt(url: string, w = 52, h = 72) {
  return url.replace("{width}", String(w)).replace("{height}", String(h));
}

export function thumb(url: string, w = 440, h = 248) {
  return url.replace("{width}", String(w)).replace("{height}", String(h));
}

/** URL über den Rust-Proxy leiten (umgeht CORS). */
const PROXY_BASE = convertFileSrc("", "twproxy");
export function proxify(url: string): string {
  if (url.startsWith(PROXY_BASE)) return url;
  return convertFileSrc(url, "twproxy");
}

export const helixApi = {
  async streamsByLogin(logins: string[]): Promise<HelixStream[]> {
    if (!logins.length) return [];
    const out: HelixStream[] = [];
    for (let i = 0; i < logins.length; i += 100) {
      const q: [string, string][] = logins.slice(i, i + 100).map((l) => ["user_login", l]);
      q.push(["first", "100"]);
      const r = await api.helix<{ data: HelixStream[] }>("streams", q);
      out.push(...r.data);
    }
    return out;
  },
  async followedStreams(userId: string): Promise<HelixStream[]> {
    const r = await api.helix<{ data: HelixStream[] }>("streams/followed", [
      ["user_id", userId],
      ["first", "100"],
    ]);
    return r.data;
  },
  async usersById(ids: string[]): Promise<HelixUser[]> {
    const out: HelixUser[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const q: [string, string][] = ids.slice(i, i + 100).map((id) => ["id", id]);
      const r = await api.helix<{ data: HelixUser[] }>("users", q);
      out.push(...r.data);
    }
    return out;
  },
  async searchChannels(query: string, first = 8): Promise<HelixChannelSearch[]> {
    const r = await api.helix<{ data: HelixChannelSearch[] }>("search/channels", [
      ["query", query],
      ["first", String(first)],
    ]);
    return r.data;
  },
  /** Geteilter Chat / Stream Together: Teilnehmer (Broadcaster-IDs) oder null */
  async sharedChatParticipants(broadcasterId: string): Promise<string[] | null> {
    const r = await api.helix<{ data: { participants: { broadcaster_id: string }[] }[] }>("shared_chat/session", [
      ["broadcaster_id", broadcasterId],
    ]);
    const s = r.data?.[0];
    return s ? s.participants.map((p) => p.broadcaster_id) : null;
  },
  async searchCategories(query: string, first = 5): Promise<HelixGame[]> {
    const r = await api.helix<{ data: HelixGame[] }>("search/categories", [
      ["query", query],
      ["first", String(first)],
    ]);
    return r.data;
  },
  async topGames(first = 20): Promise<HelixGame[]> {
    const r = await api.helix<{ data: HelixGame[] }>("games/top", [["first", String(first)]]);
    return r.data;
  },
  async streamsByGame(gameId: string, language: string, first = 40): Promise<HelixStream[]> {
    const q: [string, string][] = [
      ["game_id", gameId],
      ["first", String(first)],
    ];
    if (language) q.push(["language", language]);
    const r = await api.helix<{ data: HelixStream[] }>("streams", q);
    return r.data;
  },
  async usersByLogin(logins: string[]): Promise<HelixUser[]> {
    const out: HelixUser[] = [];
    for (let i = 0; i < logins.length; i += 100) {
      const q: [string, string][] = logins.slice(i, i + 100).map((l) => ["login", l]);
      const r = await api.helix<{ data: HelixUser[] }>("users", q);
      out.push(...r.data);
    }
    return out;
  },
};
