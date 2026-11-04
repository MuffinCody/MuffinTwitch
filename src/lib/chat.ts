import { useSyncExternalStore } from "react";
import { irc, parseIrc, type IrcMessage } from "./irc";
import { loadChannelEmotes, onSevenTvUpdate, unloadChannelEmotes, loadGlobalEmotes } from "./emotes";
import { loadChannelBadges } from "./badges";
import { getSettings } from "./settings";
import { playMentionSound } from "./sound";
import { sendPresence, subscribeChannelCosmetics, unsubscribeChannelCosmetics } from "./seventv";

export type MsgKind = "chat" | "action" | "notice" | "usernotice" | "system";

export interface ChatMsg {
  id: string;
  channel: string;
  roomId?: string;
  kind: MsgKind;
  time: number;
  login?: string;
  displayName?: string;
  userId?: string;
  color?: string;
  badges: [string, string][];
  text: string;
  /** Twitch-Emote-Tag (id:start-end,...) */
  emotes?: string;
  systemText?: string;
  reply?: { name: string; text: string };
  mention?: boolean;
  deleted?: boolean;
  first?: boolean;
  self?: boolean;
  /** Aus dem Chatverlauf geladen (vor dem Betreten des Kanals) */
  historical?: boolean;
  /** Geteilter Chat: Raum-ID des Kanals, in dem die Nachricht ursprünglich geschrieben wurde */
  sourceRoomId?: string;
  /** Systemmeldung: `text` ist eine Übersetzungs-Vorlage, das hier die Platzhalter */
  sysVars?: Record<string, string | number>;
}

const MAX_PER_CHANNEL = 300;
const MAX_MIXED = 400;
/** Bei gedrosseltem Chat: mehr Rückstau wird verworfen, damit der Chat nicht ewig hinterherhängt */
const MAX_BACKLOG = 150;

interface RoomState {
  roomId?: string;
  emoteOnly?: boolean;
  subsOnly?: boolean;
  followersOnly?: number;
  slow?: number;
}

class ChatStore {
  messages = new Map<string, ChatMsg[]>();
  mixed: ChatMsg[] = [];
  rooms = new Map<string, RoomState>();
  chatters = new Map<string, Set<string>>();
  userState = new Map<string, IrcMessage>();
  selfUserId: string | undefined;
  version = 0;
  connected = false;
  private listeners = new Set<() => void>();
  private scheduled = false;
  private seq = 0;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getVersion = () => this.version;

  /** Änderungen pro Frame bündeln → flüssiger Chat auch bei viel Traffic */
  private changed() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.version++;
      this.listeners.forEach((l) => l());
    });
  }

  list(channel: string | "*"): ChatMsg[] {
    return channel === "*" ? this.mixed : this.messages.get(channel) ?? [];
  }

  private queue: { msg: ChatMsg; at: number }[] = [];
  private queueTimer: number | undefined;
  private tokens = 0;

  /** Eingehende Nachricht: ggf. verzögern/drosseln (Einstellung), sonst sofort anzeigen. */
  receive(msg: ChatMsg) {
    const s = getSettings();
    if (msg.self || (s.chatDelay <= 0 && s.chatMaxRate <= 0 && !this.queue.length)) {
      this.push(msg);
      return;
    }
    this.queue.push({ msg, at: Date.now() + Math.max(0, s.chatDelay) * 1000 });
    if (this.queueTimer === undefined) this.queueTimer = window.setInterval(() => this.drain(), 100);
  }

  private drain() {
    const s = getSettings();
    const now = Date.now();
    const rate = s.chatMaxRate;
    if (rate > 0) {
      this.tokens = Math.min(rate, this.tokens + rate / 10);
      // Rückstau begrenzen: älteste wartende Nachrichten fallen weg
      const ready = this.queue.findIndex((q) => q.at > now);
      const readyCount = ready === -1 ? this.queue.length : ready;
      if (readyCount > MAX_BACKLOG) this.queue.splice(0, readyCount - MAX_BACKLOG);
    }
    while (this.queue.length && this.queue[0].at <= now) {
      if (rate > 0) {
        if (this.tokens < 1) break;
        this.tokens--;
      }
      this.push(this.queue.shift()!.msg);
    }
    if (!this.queue.length) {
      window.clearInterval(this.queueTimer);
      this.queueTimer = undefined;
      this.tokens = 0;
    }
  }

  /**
   * Geteilter Chat (Stream Together): Nachrichten aus einem Partnerkanal tauchen in beiden
   * Chats auf. Ist der Partnerkanal selbst offen, im gemischten Chat nur einmal anzeigen.
   */
  private isSharedDuplicate(msg: ChatMsg): boolean {
    if (!msg.sourceRoomId || msg.sourceRoomId === msg.roomId) return false;
    for (const r of this.rooms.values()) if (r.roomId === msg.sourceRoomId) return true;
    return false;
  }

  push(msg: ChatMsg) {
    if (msg.mention && !msg.self && !msg.historical) {
      const s = getSettings();
      if (s.mentionSound) playMentionSound(s.mentionVolume);
    }
    const arr = this.messages.get(msg.channel) ?? [];
    // Arrays immer neu erzeugen, damit React Änderungen erkennt
    const next = arr.length >= MAX_PER_CHANNEL ? arr.slice(arr.length - MAX_PER_CHANNEL + 1) : arr.slice();
    next.push(msg);
    this.messages.set(msg.channel, next);
    if (!this.isSharedDuplicate(msg)) {
      const mixed = this.mixed.length >= MAX_MIXED ? this.mixed.slice(this.mixed.length - MAX_MIXED + 1) : this.mixed.slice();
      mixed.push(msg);
      this.mixed = mixed;
    }
    if (msg.login) {
      const set = this.chatters.get(msg.channel) ?? new Set();
      set.add(msg.displayName ?? msg.login);
      if (set.size > 500) set.delete(set.values().next().value!);
      this.chatters.set(msg.channel, set);
    }
    this.changed();
  }

  /** Chatverlauf (vor dem Betreten) einfügen – zeitlich vor die Live-Nachrichten. */
  insertHistory(channel: string, history: ChatMsg[]) {
    if (!history.length) return;
    const existing = this.messages.get(channel) ?? [];
    const ids = new Set(existing.map((m) => m.id));
    const merged = [...history.filter((m) => !ids.has(m.id)), ...existing]
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_PER_CHANNEL);
    this.messages.set(channel, merged);
    const mixedIds = new Set(this.mixed.map((m) => m.id));
    this.mixed = [...this.mixed, ...history.filter((m) => !mixedIds.has(m.id) && !this.isSharedDuplicate(m))]
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_MIXED);
    for (const m of history) {
      if (!m.login) continue;
      const set = this.chatters.get(channel) ?? new Set();
      set.add(m.displayName ?? m.login);
      this.chatters.set(channel, set);
    }
    this.changed();
  }

  /** Systemmeldung; `text` ist eine Übersetzungs-Vorlage (deutsch) mit {Platzhaltern} */
  system(channel: string, text: string, sysVars?: Record<string, string | number>) {
    this.push({ id: `sys-${this.seq++}`, channel, kind: "system", time: Date.now(), badges: [], text, sysVars });
  }

  markDeleted(channel: string, pred: (m: ChatMsg) => boolean) {
    for (const q of this.queue) if (q.msg.channel === channel && pred(q.msg)) q.msg.deleted = true;
    const arr = this.messages.get(channel);
    if (!arr) return;
    let hit = false;
    const next = arr.map((m) => {
      if (!m.deleted && pred(m)) {
        hit = true;
        return { ...m, deleted: true };
      }
      return m;
    });
    if (!hit) return;
    this.messages.set(channel, next);
    const ids = new Set(next.filter((m) => m.deleted).map((m) => m.id));
    this.mixed = this.mixed.map((m) => (m.channel === channel && ids.has(m.id) && !m.deleted ? { ...m, deleted: true } : m));
    this.changed();
  }

  clear(channel: string) {
    this.queue = this.queue.filter((q) => q.msg.channel !== channel);
    this.messages.delete(channel);
    this.mixed = this.mixed.filter((m) => m.channel !== channel);
    this.rooms.delete(channel);
    this.chatters.delete(channel);
    this.changed();
  }

  setConnected(v: boolean) {
    this.connected = v;
    this.changed();
  }

  nextId() {
    return `local-${this.seq++}`;
  }

  touch() {
    this.changed();
  }
}

export const chat = new ChatStore();

export function useChatVersion() {
  return useSyncExternalStore(chat.subscribe, chat.getVersion);
}

function badgesFromTag(tag: string | undefined): [string, string][] {
  if (!tag) return [];
  return tag
    .split(",")
    .filter(Boolean)
    .map((b) => {
      const i = b.indexOf("/");
      return [b.slice(0, i), b.slice(i + 1)] as [string, string];
    });
}

let mentionCache = { key: "", re: null as RegExp | null };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Erwähnung des eigenen Namens oder eines der Highlight-Wörter. */
function isMention(text: string): boolean {
  const me = irc.login;
  const words = getSettings().highlightWords;
  const key = `${me}|${words}`;
  if (mentionCache.key !== key) {
    const terms = [me, ...words.split(",")].map((w) => w?.trim()).filter(Boolean) as string[];
    mentionCache = {
      key,
      re: terms.length ? new RegExp(`(^|[^\\w])@?(${terms.map(escapeRe).join("|")})(?![\\w])`, "i") : null,
    };
  }
  return mentionCache.re?.test(text) ?? false;
}

/** Während der Chatverlauf geladen wird, landen Nachrichten hier statt live im Chat. */
let historyBuffer: ChatMsg[] | null = null;

function deliver(msg: ChatMsg) {
  if (historyBuffer) {
    msg.historical = true;
    historyBuffer.push(msg);
  } else chat.receive(msg);
}

const loadedSourceBadges = new Set<string>();

/** Geteilter Chat: Herkunftskanal + dortige Badges übernehmen. */
function sharedInfo(m: IrcMessage): Partial<ChatMsg> {
  const src = m.tags["source-room-id"];
  if (!src || src === m.tags["room-id"]) return {};
  if (!loadedSourceBadges.has(src)) {
    loadedSourceBadges.add(src);
    loadChannelBadges(src).then(() => chat.touch());
  }
  return {
    sourceRoomId: src,
    ...(m.tags["source-badges"] !== undefined ? { badges: badgesFromTag(m.tags["source-badges"]) } : {}),
  };
}

function handle(m: IrcMessage) {
  const channel = m.params[0]?.startsWith("#") ? m.params[0].slice(1) : "";
  switch (m.command) {
    case "PRIVMSG": {
      let text = m.params[1] ?? "";
      let kind: MsgKind = "chat";
      const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
      if (action) {
        text = action[1];
        kind = "action";
      }
      const reply = m.tags["reply-parent-display-name"]
        ? { name: m.tags["reply-parent-display-name"], text: m.tags["reply-parent-msg-body"] ?? "" }
        : undefined;
      // "@name " am Anfang von Antworten entfernen (Twitch hängt das an)
      if (reply && text.startsWith(`@${reply.name} `)) {
        // Emote-Indizes würden sich verschieben → nur entfernen, wenn keine Twitch-Emotes
        if (!m.tags.emotes) text = text.slice(reply.name.length + 2);
      }
      deliver({
        id: m.tags.id ?? chat.nextId(),
        channel,
        roomId: m.tags["room-id"],
        kind,
        time: Number(m.tags["tmi-sent-ts"]) || Date.now(),
        login: m.nick,
        displayName: m.tags["display-name"] || m.nick,
        userId: m.tags["user-id"],
        color: m.tags.color,
        badges: badgesFromTag(m.tags.badges),
        ...sharedInfo(m),
        text,
        emotes: m.tags.emotes,
        reply,
        mention: isMention(text),
        first: m.tags["first-msg"] === "1",
      });
      break;
    }
    case "USERNOTICE": {
      deliver({
        id: m.tags.id ?? chat.nextId(),
        channel,
        roomId: m.tags["room-id"],
        kind: "usernotice",
        time: Number(m.tags["tmi-sent-ts"]) || Date.now(),
        login: m.tags.login,
        displayName: m.tags["display-name"] || m.tags.login,
        userId: m.tags["user-id"],
        color: m.tags.color,
        badges: badgesFromTag(m.tags.badges),
        ...sharedInfo(m),
        text: m.params[1] ?? "",
        emotes: m.tags.emotes,
        systemText: m.tags["system-msg"],
      });
      break;
    }
    case "CLEARCHAT": {
      const target = m.params[1];
      if (target) {
        chat.markDeleted(channel, (x) => x.login === target);
        const dur = m.tags["ban-duration"];
        chat.system(channel, dur ? "{user} wurde für {s}s getimeoutet." : "{user} wurde gebannt.", { user: target, s: dur ?? "" });
      } else {
        chat.markDeleted(channel, () => true);
        chat.system(channel, "Der Chat wurde von einem Moderator geleert.");
      }
      break;
    }
    case "CLEARMSG": {
      const id = m.tags["target-msg-id"];
      chat.markDeleted(channel, (x) => x.id === id);
      break;
    }
    case "ROOMSTATE": {
      const prev = chat.rooms.get(channel) ?? {};
      const next: RoomState = { ...prev };
      if (m.tags["room-id"]) next.roomId = m.tags["room-id"];
      if ("emote-only" in m.tags) next.emoteOnly = m.tags["emote-only"] === "1";
      if ("subs-only" in m.tags) next.subsOnly = m.tags["subs-only"] === "1";
      if ("followers-only" in m.tags) next.followersOnly = Number(m.tags["followers-only"]);
      if ("slow" in m.tags) next.slow = Number(m.tags.slow);
      chat.rooms.set(channel, next);
      if (next.roomId && next.roomId !== prev.roomId) {
        loadChannelEmotes(channel, next.roomId);
        loadChannelBadges(next.roomId).then(() => chat.touch());
        subscribeChannelCosmetics(next.roomId);
        sendPresence(next.roomId, true);
      }
      chat.touch();
      break;
    }
    case "USERSTATE": {
      chat.userState.set(channel, m);
      break;
    }
    case "GLOBALUSERSTATE": {
      chat.selfUserId = m.tags["user-id"];
      break;
    }
    case "NOTICE": {
      if (channel) chat.system(channel, m.params[1] ?? "");
      break;
    }
  }
}

let started = false;
export function startChat() {
  if (started) return;
  started = true;
  loadGlobalEmotes();
  irc.onMessage(handle);
  irc.onState((c) => chat.setConnected(c));
  onSevenTvUpdate((u) => {
    if (u.added) chat.system(u.channel, "7TV: {actor} hat das Emote {emote} hinzugefügt.", { actor: u.actor, emote: u.added });
    if (u.removed) chat.system(u.channel, "7TV: {actor} hat das Emote {emote} entfernt.", { actor: u.actor, emote: u.removed });
    if (u.renamed) chat.system(u.channel, "7TV: {actor} hat {from} in {to} umbenannt.", { actor: u.actor, from: u.renamed[0], to: u.renamed[1] });
  });
  irc.connect();
  // 7TV-Präsenz regelmäßig erneuern, damit dein Paint sichtbar bleibt
  window.setInterval(() => {
    for (const r of chat.rooms.values()) sendPresence(r.roomId);
  }, 5 * 60_000);
}

/** Letzte Nachrichten vor dem Betreten laden (recent-messages.robotty.de, wie Chatterino). */
async function loadHistory(channel: string) {
  if (!getSettings().loadChatHistory) return;
  try {
    const r = await fetch(`https://recent-messages.robotty.de/api/v2/recent-messages/${encodeURIComponent(channel)}?limit=150`);
    if (!r.ok) return;
    const data = await r.json();
    const buf: ChatMsg[] = [];
    historyBuffer = buf;
    try {
      for (const line of (data?.messages ?? []) as string[]) {
        const m = parseIrc(line);
        if (!m || (m.command !== "PRIVMSG" && m.command !== "USERNOTICE")) continue;
        handle(m);
        if (m.tags["rm-deleted"] === "1" && buf.length) buf[buf.length - 1].deleted = true;
      }
    } finally {
      historyBuffer = null;
    }
    chat.insertHistory(channel, buf);
  } catch {
    /* Verlauf nicht verfügbar */
  }
}

export function joinChannel(channel: string) {
  loadHistory(channel);
  irc.join(channel);
}

export function leaveChannel(channel: string) {
  const roomId = chat.rooms.get(channel)?.roomId;
  if (roomId) unsubscribeChannelCosmetics(roomId);
  irc.part(channel);
  chat.clear(channel);
  unloadChannelEmotes(channel);
}

/** Eigene Nachricht senden und lokal anzeigen (Twitch schickt kein Echo). */
export function sendMessage(channel: string, text: string): boolean {
  text = text.trim();
  if (!text) return false;
  if (!irc.send(channel, text)) return false;
  sendPresence(chat.rooms.get(channel)?.roomId);
  const us = chat.userState.get(channel);
  let kind: MsgKind = "chat";
  let body = text;
  if (text.startsWith("/me ")) {
    kind = "action";
    body = text.slice(4);
  } else if (text.startsWith("/") || text.startsWith(".")) {
    return true; // Befehle nicht lokal anzeigen
  }
  chat.push({
    id: chat.nextId(),
    channel,
    roomId: chat.rooms.get(channel)?.roomId,
    kind,
    time: Date.now(),
    login: irc.login ?? undefined,
    userId: chat.selfUserId,
    displayName: us?.tags["display-name"] || irc.login || "",
    color: us?.tags.color,
    badges: badgesFromTag(us?.tags.badges),
    text: body,
    self: true,
  });
  return true;
}
