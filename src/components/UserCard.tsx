import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { twitchApi, type HelixUser } from "../lib/api";
import { chat, type ChatMsg } from "../lib/chat";
import { nameColor } from "../lib/tokenize";
import { paintFor } from "../lib/seventv";
import { getSettings } from "../lib/settings";
import { useT, locale } from "../lib/i18n";
import { Icon } from "./Icon";

export interface UserCardTarget {
  login: string;
  displayName: string;
  userId?: string;
  color?: string;
  channel: string;
  x: number;
  y: number;
}

interface Props {
  target: UserCardTarget;
  myUserId?: string | null;
  canChat?: boolean;
  onMention(name: string): void;
  onOpenChannel(login: string): void;
  onClose(): void;
}

interface LogMsg {
  id: string;
  text: string;
  time: number;
  channel: string;
  deleted?: boolean;
}

/** Popup beim Klick auf einen Namen im Chat. */
export function UserCard({ target, onMention, onOpenChannel, onClose }: Props) {
  const tr = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<HelixUser & { created_at?: string } | null>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // Profil laden
  useEffect(() => {
    let cancelled = false;
    twitchApi
      .usersByLogin([target.login])
      .then((u) => !cancelled && setUser((u[0] as any) ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [target.login]);

  // Im Fenster halten
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(target.x - r.width + 40, window.innerWidth - r.width - 8));
    const top = Math.max(56, Math.min(target.y + 12, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [target.x, target.y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = window.setTimeout(() => window.addEventListener("mousedown", down), 0);
    window.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  // Ältere Nachrichten aus öffentlichen Logs (logs.ivr.fi) – nur für dort geloggte Kanäle
  const [logs, setLogs] = useState<{ state: "idle" | "loading" | "done" | "none"; items: LogMsg[] }>({ state: "idle", items: [] });
  useEffect(() => {
    if (!getSettings().loadUserLogs) return;
    let cancelled = false;
    setLogs({ state: "loading", items: [] });
    fetch(
      `https://logs.ivr.fi/channel/${encodeURIComponent(target.channel)}/user/${encodeURIComponent(target.login)}?json=1&reverse=1`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        const items: LogMsg[] = (d?.messages ?? [])
          .filter((m: any) => m.text)
          .slice(0, 150)
          .map((m: any) => ({ id: m.id, text: m.text, time: new Date(m.timestamp).getTime(), channel: target.channel }));
        if (!cancelled) setLogs({ state: items.length ? "done" : "none", items });
      })
      .catch(() => !cancelled && setLogs({ state: "none", items: [] }));
    return () => {
      cancelled = true;
    };
  }, [target.channel, target.login]);

  // Nachrichten dieser Sitzung (inkl. geladenem Verlauf) + Logs, ohne Duplikate, neueste zuerst
  const session: LogMsg[] = chat.mixed
    .filter((m) => m.login === target.login && m.kind !== "system")
    .map((m: ChatMsg) => ({ id: m.id, text: m.systemText ?? m.text, time: m.time, channel: m.channel, deleted: m.deleted }));
  const seen = new Set(session.map((m) => m.id));
  const recent = [...session, ...logs.items.filter((m) => !seen.has(m.id))].sort((a, b) => b.time - a.time);
  const today = new Date().toDateString();
  const fmt = (t: number) => {
    const d = new Date(t);
    const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === today ? time : `${d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" })} ${time}`;
  };

  const paint = paintFor(target.userId);
  const color = nameColor(target.login, target.color);
  const created = user?.created_at ? new Date(user.created_at).toLocaleDateString(locale()) : null;

  return (
    <div className="user-card" ref={ref} style={pos}>
      <div className="user-card-head">
        {user?.profile_image_url ? (
          <img className="user-card-avatar" src={user.profile_image_url} alt="" />
        ) : (
          <div className="user-card-avatar ph">{target.displayName[0]?.toUpperCase()}</div>
        )}
        <div className="user-card-info">
          <div className="user-card-name" style={paint ? paint : { color }}>
            {target.displayName}
          </div>
          {created && <div className="muted small">{tr("Konto seit {date}", { date: created })}</div>}
        </div>
        <button className="icon-btn" onClick={onClose} title={tr("Schließen")}>
          <Icon name="close" />
        </button>
      </div>

      <div className="user-card-actions">
        <button
          onClick={() => {
            onMention(target.displayName);
            onClose();
          }}
        >
          @ {tr("Erwähnen")}
        </button>
        <button onClick={() => onOpenChannel(target.login)} title={tr("Kanal öffnen")}>
          ▶ {tr("Kanal")}
        </button>
        <button onClick={() => openUrl(`https://www.twitch.tv/${target.login}`)} title={tr("Profil auf twitch.tv öffnen")}>
          ↗
        </button>
      </div>

      <div className="user-card-messages">
          <div className="section-title">
            {tr("Nachrichten")} {recent.length > 0 && <span className="muted">({recent.length})</span>}
          </div>
          {recent.length === 0 && logs.state !== "loading" && <div className="hint">{tr("Keine Nachrichten gefunden.")}</div>}
          {recent.map((m) => (
            <div key={`${m.channel}-${m.id}`} className={`uc-msg ${m.deleted ? "deleted" : ""}`}>
              <span className="ts">{fmt(m.time)}</span>
              {chat.messages.size > 1 && <span className="chan-tag">{m.channel}</span>}
              {m.text}
            </div>
          ))}
          {logs.state === "loading" && <div className="hint">{tr("Lade ältere Nachrichten…")}</div>}
          {logs.state === "none" && getSettings().loadUserLogs && (
            <div className="hint small">{tr("Für #{ch} gibt es keine öffentlichen Logs – nur Nachrichten seit dem Öffnen.", { ch: target.channel })}</div>
          )}
        </div>
    </div>
  );
}
