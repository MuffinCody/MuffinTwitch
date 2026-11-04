import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type AuthInfo, type DeviceCode } from "../lib/api";
import { CHAT_FONTS, useSettings, updateSettings } from "../lib/settings";
import { playMentionSound } from "../lib/sound";

export type SettingsTab = "account" | "chat" | "player";
type Tab = SettingsTab;

interface Props {
  auth: AuthInfo | null;
  initialTab?: SettingsTab;
  onClose(): void;
  onAuthChanged(): void;
}

function Range(props: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format(v: number): string;
  onChange(v: number): void;
}) {
  return (
    <label className="row">
      <span className="row-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="row-value">{props.format(props.value)}</span>
    </label>
  );
}

function Check(props: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        {props.label}
        {props.hint && <span className="muted small"> – {props.hint}</span>}
      </span>
    </label>
  );
}

export function SettingsDialog({ auth, initialTab, onClose, onAuthChanged }: Props) {
  const s = useSettings();
  const [tab, setTab] = useState<Tab>(initialTab ?? (auth?.logged_in ? "chat" : "account"));
  const [clientId, setClientId] = useState(auth?.client_id ?? "");
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(!!auth?.app);
  const pollRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(pollRef.current), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const startLogin = async () => {
    setError(null);
    try {
      await api.authSetClientId(clientId);
      const d = await api.authStart();
      setDevice(d);
      openUrl(d.verification_uri).catch(() => {});
      const deadline = Date.now() + d.expires_in * 1000;
      const poll = async () => {
        if (Date.now() > deadline) {
          setDevice(null);
          setError("Code abgelaufen – bitte erneut versuchen.");
          return;
        }
        try {
          const r = await api.authPoll(d.device_code);
          if (r === "ok") {
            setDevice(null);
            onAuthChanged();
            return;
          }
          pollRef.current = window.setTimeout(poll, Math.max(2, d.interval) * 1000);
        } catch (e) {
          setDevice(null);
          setError(String(e));
        }
      };
      pollRef.current = window.setTimeout(poll, d.interval * 1000);
    } catch (e) {
      setError(String(e));
    }
  };

  const logout = async (which: "all" | "web" | "app") => {
    await api.authLogout(which);
    onAuthChanged();
  };

  const webLogin = () => {
    setError(null);
    api.authWebLogin().catch((e) => setError(String(e)));
  };

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Einstellungen</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="tabs">
          <button className={tab === "account" ? "on" : ""} onClick={() => setTab("account")}>Konto</button>
          <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>Chat</button>
          <button className={tab === "player" ? "on" : ""} onClick={() => setTab("player")}>Player</button>
        </div>

        {tab === "account" && (
          <section>
            {auth?.logged_in ? (
              <div className="row">
                Angemeldet als <b>{auth.login}</b>
                <div className="spacer" />
                <button onClick={() => logout("all")}>Abmelden</button>
              </div>
            ) : (
              <p className="muted">Ohne Login kannst du Streams schauen und den Chat lesen.</p>
            )}

            <div className="account-row">
              <div>
                <b>twitch.tv-Login</b>
                <div className="muted small">
                  {auth?.web
                    ? "Aktiv – Turbo/Abos (keine Werbung), Kanalpunkte und Chat."
                    : "Normale Twitch-Anmeldung im eigenen Fenster. Nötig für Turbo/Abo ohne Werbung und Kanalpunkte."}
                </div>
              </div>
              {auth?.web ? (
                <button onClick={() => logout("web")}>Trennen</button>
              ) : (
                <button className="primary" onClick={webLogin}>
                  Mit Twitch anmelden
                </button>
              )}
            </div>

            <h3>Gefolgte Kanäle</h3>
            <label className="row">
              <span className="row-label">Automatisch aktualisieren</span>
              <select
                value={s.followRefreshMin}
                onChange={(e) => updateSettings({ followRefreshMin: Number(e.target.value) })}
              >
                {[1, 2, 5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    alle {m} Min.
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">Mit ⟳ neben „Gefolgt · Live“ jederzeit sofort aktualisieren.</p>

            <h3>Kanalpunkte</h3>
            <Check
              label="Bonus-Truhe automatisch einsammeln"
              hint="für alle geöffneten Kanäle"
              checked={s.autoClaimPoints}
              onChange={(v) => updateSettings({ autoClaimPoints: v })}
            />

            <button className="link" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? "▾" : "▸"} Erweitert: eigene Twitch-App (optional)
            </button>

            {showAdvanced &&
              (auth?.app ? (
                <div className="account-row">
                  <div>
                    <b>Eigene App verbunden</b>
                    <div className="muted small">Wird für Chat und gefolgte Kanäle bevorzugt.</div>
                  </div>
                  <button onClick={() => logout("app")}>Trennen</button>
                </div>
              ) : (
                <>
                  <p className="muted">
                    Falls Chat oder gefolgte Kanäle mit dem twitch.tv-Login nicht klappen: Erstelle auf{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        openUrl("https://dev.twitch.tv/console/apps/create");
                      }}
                    >
                      dev.twitch.tv
                    </a>{" "}
                    eine App mit Client-Typ <b>„Öffentlich“</b> (OAuth-Redirect: <code>http://localhost</code>) und
                    trage die Client-ID hier ein.
                  </p>
                  <div className="row">
                    <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client-ID" spellCheck={false} />
                    <button disabled={!clientId.trim() || !!device} onClick={startLogin}>
                      Verbinden
                    </button>
                  </div>
                  {device && (
                    <div className="device">
                      Im Browser bestätigen. Code: <span className="code">{device.user_code}</span>
                      <button onClick={() => openUrl(device.verification_uri)}>Seite erneut öffnen</button>
                    </div>
                  )}
                </>
              ))}
            {error && <div className="error">{error}</div>}
          </section>
        )}

        {tab === "chat" && (
          <>
            <section>
              <h3>Darstellung</h3>
              <label className="row">
                <span className="row-label">Schriftart</span>
                <select
                  value={s.chatFontFamily}
                  onChange={(e) => updateSettings({ chatFontFamily: e.target.value })}
                  style={{ fontFamily: s.chatFontFamily, flex: 1 }}
                >
                  {CHAT_FONTS.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <Range label="Schriftgröße" min={11} max={24} value={s.chatFontSize} format={(v) => `${v}px`} onChange={(v) => updateSettings({ chatFontSize: v })} />
              <Range label="Zeilenabstand" min={1.2} max={2.2} step={0.1} value={s.chatLineSpacing} format={(v) => v.toFixed(1)} onChange={(v) => updateSettings({ chatLineSpacing: v })} />
              <Range label="Emote-Größe" min={0.6} max={2} step={0.1} value={s.emoteScale} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateSettings({ emoteScale: v })} />
              <div className="font-preview" style={{ fontFamily: s.chatFontFamily, fontSize: s.chatFontSize, lineHeight: s.chatLineSpacing }}>
                <b style={{ color: "#a970ff" }}>Beispiel</b>: So sieht der Chat aus. Kappa 123
              </div>
              <Check label="Zeitstempel anzeigen" checked={s.showTimestamps} onChange={(v) => updateSettings({ showTimestamps: v })} />
              <Check label="Zeilen abwechselnd hinterlegen" checked={s.chatAltRows} onChange={(v) => updateSettings({ chatAltRows: v })} />
              <Check label="Badges anzeigen" checked={s.showBadges} onChange={(v) => updateSettings({ showBadges: v })} />
              <Check label="7TV-Namensfarben (Paints)" checked={s.show7tvPaints} onChange={(v) => updateSettings({ show7tvPaints: v })} />
            </section>

            <section>
              <h3>Erwähnungen</h3>
              <Check label="Ton abspielen, wenn ich erwähnt werde" checked={s.mentionSound} onChange={(v) => updateSettings({ mentionSound: v })} />
              <div className="row">
                <span className="row-label">Lautstärke</span>
                <input type="range" min={0.05} max={1} step={0.05} value={s.mentionVolume} onChange={(e) => updateSettings({ mentionVolume: Number(e.target.value) })} />
                <button onClick={() => playMentionSound(s.mentionVolume)}>Test</button>
              </div>
              <label className="row">
                <span className="row-label">Weitere Wörter</span>
                <input
                  value={s.highlightWords}
                  onChange={(e) => updateSettings({ highlightWords: e.target.value })}
                  placeholder="z. B. Spitzname, Giveaway (kommagetrennt)"
                  style={{ flex: 1 }}
                />
              </label>
            </section>

            <section>
              <h3>Geschwindigkeit</h3>
              <Range
                label="Max. Nachrichten/s"
                min={0}
                max={30}
                value={s.chatMaxRate}
                format={(v) => (v === 0 ? "unbegrenzt" : `${v}/s`)}
                onChange={(v) => updateSettings({ chatMaxRate: v })}
              />
              <p className="muted small">Macht schnelle Chats langsamer. Bei zu viel Rückstau werden ältere Nachrichten übersprungen.</p>
              <Range
                label="Verzögerung"
                min={0}
                max={15}
                step={0.5}
                value={s.chatDelay}
                format={(v) => (v === 0 ? "aus" : `${v}s`)}
                onChange={(v) => updateSettings({ chatDelay: v })}
              />
              <p className="muted small">Zeigt Nachrichten später an – passend zur Verzögerung des Streams (keine Spoiler).</p>
              <Check label="Chat pausieren, solange die Maus darüber ist" checked={s.pauseOnHover} onChange={(v) => updateSettings({ pauseOnHover: v })} />
            </section>

            <section>
              <h3>Verlauf</h3>
              <Check
                label="Beim Öffnen die letzten Nachrichten laden"
                hint="über recent-messages.robotty.de"
                checked={s.loadChatHistory}
                onChange={(v) => updateSettings({ loadChatHistory: v })}
              />
              <Check
                label="Im Nutzer-Fenster ältere Nachrichten zeigen"
                hint="aus öffentlichen Logs von logs.ivr.fi, nicht für jeden Kanal verfügbar"
                checked={s.loadUserLogs}
                onChange={(v) => updateSettings({ loadUserLogs: v })}
              />
            </section>
          </>
        )}

        {tab === "player" && (
          <section>
            <Check label="Niedrige Latenz" hint="holt Verzögerung automatisch auf" checked={s.lowLatency} onChange={(v) => updateSettings({ lowLatency: v })} />
            <Check label="Multiview: nur den angeklickten Stream hörbar" checked={s.audioFocus} onChange={(v) => updateSettings({ audioFocus: v })} />
            <label className="row">
              <span className="row-label">Standardqualität</span>
              <select value={s.defaultQuality} onChange={(e) => updateSettings({ defaultQuality: e.target.value as "auto" | "source" })}>
                <option value="auto">Auto (an Kachelgröße angepasst)</option>
                <option value="source">Source (beste)</option>
              </select>
            </label>
            <p className="muted small">
              Tipp: „Auto“ schont im Multiview CPU/GPU deutlich. Änderungen gelten für neu geöffnete Streams.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
