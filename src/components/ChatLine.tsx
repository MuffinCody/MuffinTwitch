import { memo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ChatMsg } from "../lib/chat";
import { tokenize, nameColor } from "../lib/tokenize";
import { findBadge } from "../lib/badges";
import { emoteVersion, type Emote } from "../lib/emotes";
import type { Token } from "../lib/tokenize";

// Zerlegte Nachrichten zwischenspeichern – nur neu berechnen, wenn sich Emotes geändert haben
const tokenCache = new WeakMap<ChatMsg, { v: number; tokens: Token[] }>();
function cachedTokens(msg: ChatMsg): Token[] {
  if (!msg.text) return [];
  const v = emoteVersion();
  const hit = tokenCache.get(msg);
  if (hit && hit.v === v) return hit.tokens;
  const tokens = tokenize(msg.channel, msg.text, msg.emotes);
  tokenCache.set(msg, { v, tokens });
  return tokens;
}
import { paintFor, stvBadgeFor } from "../lib/seventv";
import { t, locale } from "../lib/i18n";

function EmoteImg({ e, overlays }: { e: Emote; overlays: Emote[] }) {
  const img = (x: Emote, cls: string) => (
    <img
      key={x.id + cls}
      className={cls}
      src={x.url}
      srcSet={x.srcset}
      alt={x.name}
      title={`${x.name} (${x.provider.toUpperCase()})`}
      loading="lazy"
      decoding="async"
    />
  );
  if (!overlays.length) return img(e, "emote");
  return (
    <span className="emote-stack">
      {img(e, "emote")}
      {overlays.map((o) => img(o, "emote overlay"))}
    </span>
  );
}

interface Props {
  msg: ChatMsg;
  showChannel: boolean;
  showTimestamp: boolean;
  showBadges: boolean;
  showPaints: boolean;
  /** Ändert sich, wenn neue Emotes/7TV-Paints geladen wurden → Neu-Rendern */
  renderVersion: number;
  /** Profilbild des Streamers (statt Kanalname im gemischten Chat) */
  chanAvatar?: string;
  /** Geteilter Chat: Kanal, aus dem die Nachricht stammt */
  sourceUser?: { display_name: string; profile_image_url: string };
  onName?: (msg: ChatMsg, x: number, y: number) => void;
  /** Sprache – nur damit die Zeile bei einem Sprachwechsel neu gezeichnet wird */
  lang: string;
}

function ChannelTag({ channel, avatar }: { channel: string; avatar?: string }) {
  return avatar ? (
    <img className="chan-avatar" src={avatar} alt={channel} title={channel} />
  ) : (
    <span className="chan-tag">{channel}</span>
  );
}

function ChatLineInner({ msg, showChannel, showTimestamp, showBadges, showPaints, chanAvatar, sourceUser, onName }: Props) {
  if (msg.kind === "system") {
    return (
      <div className="line system">
        {showChannel && <ChannelTag channel={msg.channel} avatar={chanAvatar} />}
        {t(msg.text, msg.sysVars)}
      </div>
    );
  }

  const tokens = cachedTokens(msg);
  const color = msg.login ? nameColor(msg.login, msg.color) : undefined;
  const paint = showPaints ? paintFor(msg.userId) : undefined;
  const stvBadge = stvBadgeFor(msg.userId);
  const time = new Date(msg.time).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

  const cls = ["line", msg.kind, msg.mention && "mention", msg.deleted && "deleted", msg.first && "first"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      {msg.kind === "usernotice" && msg.systemText && <div className="sys-text">{msg.systemText}</div>}
      {msg.reply && (
        <div className="reply">
          ↳ {t("Antwort an")} <b>@{msg.reply.name}</b>: {msg.reply.text}
        </div>
      )}
      {(msg.kind !== "usernotice" || msg.text) && (
        <>
          {showTimestamp && <span className="ts">{time}</span>}
          {showChannel && <ChannelTag channel={msg.channel} avatar={chanAvatar} />}
          {sourceUser && (
            <img
              className="source-avatar"
              src={sourceUser.profile_image_url}
              alt=""
              title={t("Aus dem Chat von {name}", { name: sourceUser.display_name })}
            />
          )}
          {msg.sourceRoomId && !sourceUser && <span className="source-dot" title={t("Aus einem Partnerkanal (geteilter Chat)")} />}
          {showBadges &&
            msg.badges.map(([set, ver]) => {
              const b = findBadge(msg.sourceRoomId ?? msg.roomId, set, ver);
              return b ? <img key={set} className="badge" src={b.url} srcSet={b.srcset} alt={b.title} title={b.title} /> : null;
            })}
          {showBadges && stvBadge && (
            <img className="badge" src={stvBadge.url} srcSet={stvBadge.srcset} alt={stvBadge.title} title={`7TV: ${stvBadge.title}`} />
          )}
          <span
            className={paint ? "name painted" : "name"}
            style={paint ? { ...paint, ["--fallback" as any]: color } : { color }}
            onClick={(e) => onName?.(msg, e.clientX, e.clientY)}
          >
            {msg.displayName}
          </span>
          {msg.kind === "action" ? " " : <span className="colon">: </span>}
          <span className="body" style={msg.kind === "action" ? { color } : undefined}>
            {tokens.map((t, i) => {
              switch (t.t) {
                case "text":
                  return <span key={i}>{t.v}</span>;
                case "emote":
                  return <EmoteImg key={i} e={t.e} overlays={t.overlays} />;
                case "mention":
                  return (
                    <span key={i} className="at">
                      {t.v}
                    </span>
                  );
                case "link":
                  return (
                    <a
                      key={i}
                      href={t.href}
                      onClick={(ev) => {
                        ev.preventDefault();
                        openUrl(t.href).catch(() => {});
                      }}
                    >
                      {t.v}
                    </a>
                  );
              }
            })}
          </span>
        </>
      )}
    </div>
  );
}

export const ChatLine = memo(ChatLineInner);
