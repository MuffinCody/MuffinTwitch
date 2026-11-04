import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { chat, sendMessage, useChatVersion, type ChatMsg } from "../lib/chat";
import { UserCard, type UserCardTarget } from "./UserCard";
import { irc } from "../lib/irc";
import { emoteNames, onEmotesChanged, channelEmoteCount } from "../lib/emotes";
import { onCosmeticsChanged } from "../lib/seventv";
import { useSettings } from "../lib/settings";
import { usePoints, formatPoints } from "../lib/points";
import { PointsMenu, pointsIcon } from "./PointsMenu";
import { ChatLine } from "./ChatLine";
import { EmotePicker, rememberEmote } from "./EmotePicker";
import { Icon } from "./Icon";
import type { HelixUser } from "../lib/api";

interface Props {
  channels: string[];
  active: string | "*";
  onActive(c: string | "*"): void;
  loggedIn: boolean;
  userId: string | null;
  onLogin(): void;
  onHide(): void;
  /** Profilbilder der Streamer (login → URL) für den gemischten Chat */
  channelAvatars: Record<string, string | undefined>;
  onOpenSettings(): void;
  onOpenChannel(login: string): void;
  /** Twitch-User-ID → Nutzer (Herkunft von Nachrichten im geteilten Chat) */
  roomUsers: Record<string, HelixUser>;
  /** Stream Together: Kanal → Partner */
  together: Record<string, HelixUser[]>;
}

function PointsBadge({ channel }: { channel: string }) {
  const st = usePoints(channel);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [channel]);
  if (!st || st.balance === undefined) return null;
  const icon = pointsIcon(channel);
  return (
    <>
      <button
        className={`points ${st.claimId ? "claimable" : ""} ${open ? "open" : ""}`}
        title={st.claimId ? "Bonus verfügbar – Kanalpunkte öffnen" : "Kanalpunkte"}
        onClick={() => setOpen((o) => !o)}
      >
        {icon ? <img className="points-ico" src={icon} alt="" /> : <Icon name="points" />}
        {formatPoints(st.balance)}
        {st.claimId && <span className="claim-dot" />}
      </button>
      {open && <PointsMenu channel={channel} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ChatPanel({ channels, active, onActive, loggedIn, userId, onLogin, onHide, channelAvatars, onOpenSettings, onOpenChannel, roomUsers, together }: Props) {
  const [card, setCard] = useState<UserCardTarget | null>(null);
  useChatVersion();
  const settings = useSettings();
  const [renderVersion, setRenderVersion] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [input, setInput] = useState("");
  const [sendTarget, setSendTarget] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const completion = useRef<{ prefix: string; matches: string[]; idx: number; start: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bump = () => setRenderVersion((v) => v + 1);
    const a = onEmotesChanged(bump);
    const b = onCosmeticsChanged(bump);
    return () => {
      a();
      b();
    };
  }, []);

  const mixed = active === "*";
  const messages = chat.list(active);
  const target = mixed ? sendTarget || channels[0] : active;
  const room = target ? chat.rooms.get(target) : undefined;
  const frozen = paused || hoverPaused;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && !frozen) el.scrollTop = el.scrollHeight;
  });

  useEffect(() => setPaused(false), [active]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom === paused) setPaused(!atBottom);
  };

  const resume = () => {
    setPaused(false);
    setHoverPaused(false);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const insertText = useCallback((text: string) => {
    setInput((v) => `${v}${v && !v.endsWith(" ") ? " " : ""}${text} `);
    inputRef.current?.focus();
  }, []);

  const insertName = useCallback((name: string) => insertText(`@${name}`), [insertText]);
  const openCard = useCallback((m: ChatMsg, x: number, y: number) => {
    if (!m.login) return;
    setCard({ login: m.login, displayName: m.displayName ?? m.login, userId: m.userId, color: m.color, channel: m.channel, x, y });
  }, []);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const caret = el.selectionStart ?? input.length;
      let c = completion.current;
      if (!c) {
        const before = input.slice(0, caret);
        const start = before.search(/\S+$/);
        if (start === -1) return;
        const prefix = before.slice(start);
        const lower = prefix.replace(/^@/, "").toLowerCase();
        const users = [...(chat.chatters.get(target) ?? [])].map((u) => (prefix.startsWith("@") ? `@${u}` : u));
        const pool = prefix.startsWith("@") ? users : [...emoteNames(target), ...users];
        const matches = [...new Set(pool)]
          .filter((n) => n.replace(/^@/, "").toLowerCase().startsWith(lower))
          .sort((a, b) => a.length - b.length || a.localeCompare(b))
          .slice(0, 50);
        if (!matches.length) return;
        c = { prefix, matches, idx: -1, start };
        completion.current = c;
      }
      c.idx = (c.idx + (e.shiftKey ? -1 : 1) + c.matches.length) % c.matches.length;
      const word = c.matches[c.idx];
      const rest = input.slice(c.start).replace(/^\S*/, "");
      const next = `${input.slice(0, c.start)}${word}${rest.startsWith(" ") ? rest : ` ${rest}`}`;
      setInput(next);
      requestAnimationFrame(() => {
        const pos = c!.start + word.length + 1;
        el.setSelectionRange(pos, pos);
      });
      return;
    }
    completion.current = null;
    if (e.key === "Enter") {
      if (target && sendMessage(target, input)) {
        for (const w of input.split(/\s+/)) if (emoteNames(target).includes(w)) rememberEmote(w);
        setInput("");
      }
    }
  };

  const modes: string[] = [];
  if (room?.emoteOnly) modes.push("Nur Emotes");
  if (room?.subsOnly) modes.push("Nur Subs");
  if (room?.followersOnly !== undefined && room.followersOnly >= 0)
    modes.push(`Follower ${room.followersOnly ? `${room.followersOnly} min` : ""}`.trim());
  if (room?.slow) modes.push(`Slow ${room.slow}s`);
  if (settings.chatDelay > 0) modes.push(`Verzögert ${settings.chatDelay}s`);
  if (settings.chatMaxRate > 0) modes.push(`max. ${settings.chatMaxRate}/s`);

  const listStyle = {
    fontSize: settings.chatFontSize,
    fontFamily: `"${settings.chatFontFamily}", "Segoe UI", sans-serif`,
    lineHeight: settings.chatLineSpacing,
    ["--emote-h" as any]: `${Math.round(28 * settings.emoteScale)}px`,
  };

  return (
    <aside className="chat-panel" style={{ width: settings.chatWidth }}>
      <div className="chat-tabs">
        {channels.length > 1 && (
          <button className={mixed ? "tab active" : "tab"} onClick={() => onActive("*")} title="Alle Chats gemischt">
            Alle
          </button>
        )}
        {channels.map((c) => (
          <button key={c} className={active === c ? "tab active" : "tab"} onClick={() => onActive(c)}>
            {c}
          </button>
        ))}
        <span className={chat.connected ? "conn ok" : "conn"} title={chat.connected ? "Chat verbunden" : "Verbinde…"} />
        <button className="collapse pinned" title="Chat ausblenden (Strg+J)" onClick={onHide}>
          <Icon name="panel-right" />
        </button>
      </div>

      {!mixed && target && together[target]?.length > 0 && (
        <div className="shared-info" title="Nachrichten aus den Partnerkanälen erscheinen hier mit deren Profilbild">
          <span>Geteilter Chat mit</span>
          {together[target].map((u) => (
            <button key={u.id} className="together-chip small" onClick={() => onOpenChannel(u.login)}>
              <img src={u.profile_image_url} alt="" />
              {u.display_name}
            </button>
          ))}
        </div>
      )}

      {(modes.length > 0 || (target && channelEmoteCount(target) > 0)) && (
        <div className="chat-info">
          {modes.join(" · ")}
          {target && channelEmoteCount(target) > 0 && (
            <span className="emote-count">{channelEmoteCount(target)} Kanal-Emotes</span>
          )}
        </div>
      )}

      <div className="chat-list-wrap">
      <div
        ref={listRef}
        className={`chat-list ${settings.chatAltRows ? "alt-rows" : ""}`}
        onScroll={onScroll}
        onMouseEnter={() => settings.pauseOnHover && setHoverPaused(true)}
        onMouseLeave={() => hoverPaused && resume()}
        style={listStyle}
      >
        {channels.length === 0 && <div className="chat-empty">Öffne einen Kanal, um den Chat zu sehen.</div>}
        {messages.map((m) => (
          <ChatLine
            key={`${m.channel}-${m.id}`}
            msg={m}
            showChannel={mixed}
            showTimestamp={settings.showTimestamps}
            showBadges={settings.showBadges}
            showPaints={settings.show7tvPaints}
            renderVersion={renderVersion}
            chanAvatar={channelAvatars[m.channel]}
            sourceUser={m.sourceRoomId && m.sourceRoomId !== m.roomId ? roomUsers[m.sourceRoomId] : undefined}
            onName={openCard}
          />
        ))}
      </div>
      {frozen && (
        <button className="resume" onClick={resume}>
          {hoverPaused && !paused ? "Chat pausiert (Maus über Chat)" : "↓ Chat pausiert – nach unten springen"}
        </button>
      )}
      </div>

      {pickerOpen && target && (
        <EmotePicker channel={target} userId={userId} onPick={insertText} onClose={() => setPickerOpen(false)} />
      )}

      <div className="chat-input">
        {loggedIn ? (
          <>
            {mixed && channels.length > 1 && (
              <select value={target} onChange={(e) => setSendTarget(e.target.value)} title="Senden an">
                {channels.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
            <div className="input-wrap">
              <input
                ref={inputRef}
                value={input}
                disabled={!target || !irc.canSend}
                onChange={(e) => {
                  completion.current = null;
                  setInput(e.target.value);
                }}
                onKeyDown={onKey}
                placeholder={target ? `Nachricht an #${target}` : "Kein Kanal"}
                maxLength={500}
              />
              <button
                className="emote-btn"
                title="Emotes"
                disabled={!target}
                onClick={() => setPickerOpen((v) => !v)}
              >
                <Icon name="smile" />
              </button>
            </div>
          </>
        ) : (
          <button className="login-hint" onClick={onLogin}>
            Anmelden, um zu chatten
          </button>
        )}
      </div>
      {card && (
        <UserCard
          target={card}
          myUserId={userId}
          canChat={loggedIn}
          onMention={insertName}
          onOpenChannel={(l) => {
            setCard(null);
            onOpenChannel(l);
          }}
          onClose={() => setCard(null)}
        />
      )}

      {(loggedIn || channels.length > 0) && (
        <div className="chat-foot">
          {loggedIn && target && <PointsBadge channel={target} />}
          <span className="spacer" />
          <button className="icon-btn small" title="Chat-Einstellungen" onClick={onOpenSettings}>
            <Icon name="settings" size={18} />
          </button>
        </div>
      )}
    </aside>
  );
}
