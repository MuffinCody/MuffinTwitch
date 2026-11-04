import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, helixApi, type HelixUser } from "../lib/api";
import { chat, type ChatMsg } from "../lib/chat";
import { nameColor } from "../lib/tokenize";
import { paintFor } from "../lib/seventv";
import { getSettings } from "../lib/settings";
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
  myUserId: string | null;
  canChat: boolean;
  onMention(name: string): void;
  onOpenChannel(login: string): void;
  onClose(): void;
}

type Tab = "messages" | "whisper";

interface LogMsg {
  id: string;
  text: string;
  time: number;
  channel: string;
  deleted?: boolean;
}

/** Popup beim Klick auf einen Namen im Chat. */
export function UserCard({ target, myUserId, canChat, onMention, onOpenChannel, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<HelixUser & { created_at?: string } | null>(null);
  const [tab, setTab] = useState<Tab>("messages");
  const [whisper, setWhisper] = useState("");
  const [whisperState, setWhisperState] = useState<{ ok?: string; error?: string; sending?: boolean }>({});
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // Profil laden
  useEffect(() => {
    let cancelled = false;
    helixApi
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
    const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === today ? time : `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
  };

  const sendWhisper = async () => {
    const text = whisper.trim();
    const toId = target.userId ?? user?.id;
    if (!text || !myUserId || !toId) return;
    setWhisperState({ sending: true });
    try {
      await api.helixPost("whispers", [["from_user_id", myUserId], ["to_user_id", toId]], { message: text });
      setWhisper("");
      setWhisperState({ ok: "Gesendet." });
    } catch (e) {
      const msg = String(e);
      setWhisperState({
        error: /401|403|scope/i.test(msg)
          ? `${msg} – Twitch erlaubt Flüstern nur mit verifizierter Telefonnummer und passender Berechtigung (ggf. unter Einstellungen → Erweitert die eigene App neu verbinden).`
          : msg,
      });
    }
  };

  const paint = paintFor(target.userId);
  const color = nameColor(target.login, target.color);
  const created = user?.created_at ? new Date(user.created_at).toLocaleDateString("de-DE") : null;

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
          {created && <div className="muted small">Konto seit {created}</div>}
        </div>
        <button className="icon-btn" onClick={onClose} title="Schließen">
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
          @ Erwähnen
        </button>
        <button className={tab === "whisper" ? "on" : ""} onClick={() => setTab(tab === "whisper" ? "messages" : "whisper")}>
          ✉ Flüstern
        </button>
        <button onClick={() => onOpenChannel(target.login)} title="Kanal öffnen">
          ▶ Kanal
        </button>
        <button onClick={() => openUrl(`https://www.twitch.tv/${target.login}`)} title="Profil auf twitch.tv öffnen">
          ↗
        </button>
      </div>

      {tab === "whisper" ? (
        <div className="user-card-whisper">
          <textarea
            autoFocus
            value={whisper}
            maxLength={500}
            placeholder={`Flüsternachricht an ${target.displayName}…`}
            disabled={!canChat || whisperState.sending}
            onChange={(e) => setWhisper(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendWhisper();
              }
            }}
          />
          <div className="row">
            {whisperState.ok && <span className="ok small">{whisperState.ok}</span>}
            <div className="spacer" />
            <button className="primary" disabled={!canChat || !whisper.trim() || whisperState.sending} onClick={sendWhisper}>
              Senden
            </button>
          </div>
          {whisperState.error && <div className="error small">{whisperState.error}</div>}
        </div>
      ) : (
        <div className="user-card-messages">
          <div className="section-title">
            Nachrichten {recent.length > 0 && <span className="muted">({recent.length})</span>}
          </div>
          {recent.length === 0 && logs.state !== "loading" && <div className="hint">Keine Nachrichten gefunden.</div>}
          {recent.map((m) => (
            <div key={`${m.channel}-${m.id}`} className={`uc-msg ${m.deleted ? "deleted" : ""}`}>
              <span className="ts">{fmt(m.time)}</span>
              {chat.messages.size > 1 && <span className="chan-tag">{m.channel}</span>}
              {m.text}
            </div>
          ))}
          {logs.state === "loading" && <div className="hint">Lade ältere Nachrichten…</div>}
          {logs.state === "none" && getSettings().loadUserLogs && (
            <div className="hint small">Für #{target.channel} gibt es keine öffentlichen Logs – nur Nachrichten seit dem Öffnen.</div>
          )}
        </div>
      )}
    </div>
  );
}
