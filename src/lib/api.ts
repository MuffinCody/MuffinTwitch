import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export interface AuthInfo {
  logged_in: boolean;
  login: string | null;
  user_id: string | null;
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
  authWebLogin: () => invoke<void>("auth_web_login"),
  authLogout: () => invoke<void>("auth_logout"),
  chatCredentials: () => invoke<{ login: string; token: string } | null>("auth_chat_credentials"),
  /** Lese-Abfrage an Twitch (wie die Webseite), mit Login falls vorhanden. */
  gql: <T = any>(query: string, variables: Record<string, unknown> = {}) =>
    invoke<T>("twitch_gql", { query, variables }),
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

export interface FollowedStream extends HelixStream {
  profile_image_url?: string;
}

// ---------- Umwandlung der Twitch-Antworten in die gewohnten Formen ----------

const USER_FIELDS = "id login displayName profileImageURL(width: 70)";
const STREAM_FIELDS = "id title viewersCount createdAt game { id name }";

/** "…/18122-52x72.jpg" → "…/18122-{width}x{height}.jpg" */
function sizeTemplate(url: string | null | undefined): string {
  return (url ?? "").replace(/-\d+x\d+(\.\w+)$/, "-{width}x{height}$1");
}

function previewTemplate(login: string) {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-{width}x{height}.jpg`;
}

function toUser(u: any): HelixUser {
  return { id: u.id, login: u.login, display_name: u.displayName ?? u.login, profile_image_url: u.profileImageURL ?? "" };
}

function toStream(u: any, st: any): HelixStream {
  return {
    id: st.id,
    user_id: u.id,
    user_login: u.login,
    user_name: u.displayName ?? u.login,
    game_name: st.game?.name ?? "",
    title: st.title ?? "",
    viewer_count: st.viewersCount ?? 0,
    started_at: st.createdAt ?? "",
    thumbnail_url: previewTemplate(u.login),
  };
}

function toGame(g: any): HelixGame {
  return { id: g.id, name: g.name ?? g.displayName, box_art_url: sizeTemplate(g.boxArtURL) };
}

function chunks<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const twitchApi = {
  /** Live-Streams dieser Kanäle (offline Kanäle fehlen im Ergebnis). */
  async streamsByLogin(logins: string[]): Promise<HelixStream[]> {
    const out: HelixStream[] = [];
    for (const part of chunks(logins)) {
      const r = await api.gql<{ users: any[] }>(
        `query NativStreams($logins: [String!]) { users(logins: $logins) { ${USER_FIELDS} stream { ${STREAM_FIELDS} } } }`,
        { logins: part },
      );
      for (const u of r.users ?? []) if (u?.stream) out.push(toStream(u, u.stream));
    }
    return out;
  },
  /** Folgt der Nutzer diesem Kanal? */
  async isFollowing(_userId: string, broadcasterId: string): Promise<boolean> {
    return invoke<boolean>("is_following_web", { channelId: broadcasterId });
  },
  async followedStreams(_userId: string): Promise<FollowedStream[]> {
    return invoke<FollowedStream[]>("followed_live_web");
  },
  /** Eigene Twitch-Emotes (Abos usw.) */
  async userEmotes(_userId: string): Promise<{ id: string; name: string }[]> {
    return invoke<{ id: string; name: string }[]>("user_emotes_web");
  },
  async usersById(ids: string[]): Promise<HelixUser[]> {
    const out: HelixUser[] = [];
    for (const part of chunks(ids)) {
      const r = await api.gql<{ users: any[] }>(`query NativUsersById($ids: [ID!]) { users(ids: $ids) { ${USER_FIELDS} } }`, {
        ids: part,
      });
      for (const u of r.users ?? []) if (u) out.push(toUser(u));
    }
    return out;
  },
  async usersByLogin(logins: string[]): Promise<HelixUser[]> {
    const out: HelixUser[] = [];
    for (const part of chunks(logins)) {
      const r = await api.gql<{ users: any[] }>(
        `query NativUsersByLogin($logins: [String!]) { users(logins: $logins) { ${USER_FIELDS} } }`,
        { logins: part },
      );
      for (const u of r.users ?? []) if (u) out.push(toUser(u));
    }
    return out;
  },
  /** Kanal- und Kategoriesuche in einer Anfrage (wie das Suchfeld auf twitch.tv). */
  async search(query: string, channels = 8, categories = 5): Promise<{ channels: HelixChannelSearch[]; games: HelixGame[] }> {
    const r = await api.gql<{ searchFor: any }>(
      `query NativSearch($q: String!) { searchFor(userQuery: $q, platform: "web") {
        channels { edges { item { ... on User { ${USER_FIELDS} stream { id } broadcastSettings { title game { name } } } } } }
        games { edges { item { ... on Game { id name displayName boxArtURL(width: 52, height: 72) } } } }
      } }`,
      { q: query },
    );
    const ch: HelixChannelSearch[] = (r.searchFor?.channels?.edges ?? [])
      .map((e: any) => e.item)
      .filter((u: any) => u?.login)
      .slice(0, channels)
      .map((u: any) => ({
        id: u.id,
        broadcaster_login: u.login,
        display_name: u.displayName ?? u.login,
        thumbnail_url: u.profileImageURL ?? "",
        is_live: !!u.stream,
        game_name: u.broadcastSettings?.game?.name ?? "",
        title: u.broadcastSettings?.title ?? "",
      }));
    const games: HelixGame[] = (r.searchFor?.games?.edges ?? [])
      .map((e: any) => e.item)
      .filter((g: any) => g?.id)
      .slice(0, categories)
      .map(toGame);
    return { channels: ch, games };
  },
  async searchChannels(query: string, first = 8): Promise<HelixChannelSearch[]> {
    return (await twitchApi.search(query, first, 0)).channels;
  },
  async searchCategories(query: string, first = 5): Promise<HelixGame[]> {
    return (await twitchApi.search(query, 0, first)).games;
  },
  /** Geteilter Chat / Stream Together: Teilnehmer (Kanal-IDs) oder null */
  async sharedChatParticipants(broadcasterId: string): Promise<string[] | null> {
    const r = await api.gql<{ user: any }>(
      `query NativSharedChat($id: ID!) { user(id: $id) { sharedChatSession { id participants { channel { id } } } } }`,
      { id: broadcasterId },
    );
    const s = r.user?.sharedChatSession;
    if (!s) return null;
    const ids = (s.participants ?? []).map((p: any) => p?.channel?.id).filter(Boolean) as string[];
    return ids.length ? ids : null;
  },
  async topGames(first = 20): Promise<HelixGame[]> {
    const r = await api.gql<{ games: any }>(
      `query NativTopGames($first: Int) { games(first: $first, options: { sort: VIEWER_COUNT }) { edges { node { id name displayName boxArtURL(width: 52, height: 72) } } } }`,
      { first },
    );
    return (r.games?.edges ?? []).map((e: any) => toGame(e.node));
  },
  async streamsByGame(gameId: string, language: string, first = 40): Promise<HelixStream[]> {
    const options = language ? { languages: [language] } : {};
    const r = await api.gql<{ game: any }>(
      `query NativGameStreams($id: ID!, $first: Int, $options: GameStreamOptions) { game(id: $id) { streams(first: $first, options: $options) { edges { node { ${STREAM_FIELDS} broadcaster { ${USER_FIELDS} } } } } } }`,
      { id: gameId, first, options },
    );
    return (r.game?.streams?.edges ?? [])
      .map((e: any) => e.node)
      .filter((n: any) => n?.broadcaster)
      .map((n: any) => toStream(n.broadcaster, n));
  },
  /** Chat-Abzeichen: global (ohne ID) oder eines Kanals */
  async badges(channelId?: string): Promise<{ setID: string; version: string; title: string; imageURL: string }[]> {
    if (!channelId) {
      const r = await api.gql<{ badges: any[] }>(`query NativBadges { badges { setID version title imageURL(size: NORMAL) } }`);
      return (r.badges ?? []).filter(Boolean);
    }
    const r = await api.gql<{ user: any }>(
      `query NativChannelBadges($id: ID!) { user(id: $id) { broadcastBadges { setID version title imageURL(size: NORMAL) } } }`,
      { id: channelId },
    );
    return (r.user?.broadcastBadges ?? []).filter(Boolean);
  },
};
