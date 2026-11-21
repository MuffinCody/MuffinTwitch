import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type AuthInfo, type DeviceCode } from "../lib/api";
import { checkForUpdates, installUpdate, useUpdate } from "../lib/updates";
import { CHAT_FONTS, useSettings, updateSettings } from "../lib/settings";
import { playMentionSound } from "../lib/sound";
import { LANGUAGES, useT, type Lang } from "../lib/i18n";
import { getVersion } from "@tauri-apps/api/app";
import { Icon } from "./Icon";
import {
  DEFAULT_SHORTCUTS,
  RESERVED_KEYS,
  SHORTCUT_ACTIONS,
  currentShortcuts,
  keyLabel,
  keyName,
  type PlayerAction,
} from "../lib/shortcuts";

export type SettingsTab = "general" | "account" | "chat" | "player";
type Tab = SettingsTab;

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: "general", label: "Allgemein", icon: "sliders" },
  { id: "account", label: "Konto", icon: "user" },
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "player", label: "Player", icon: "tv" },
];

/** Tastenkürzel-Liste mit "Taste drücken…"-Aufnahme */
function ShortcutEditor() {
  const s = useSettings();
  const t = useT();
  const [recording, setRecording] = useState<PlayerAction | null>(null);
  const map = { ...DEFAULT_SHORTCUTS, ...s.shortcuts };

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      // Vor allen anderen Tastatur-Handlern abfangen (Esc schließt sonst das Fenster)
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const next: Record<string, string> = { ...currentShortcuts() };
      if (e.key === "Backspace" || e.key === "Delete") {
        next[recording] = "";
      } else {
        if (RESERVED_KEYS.has(e.key) || e.ctrlKey || e.altKey || e.metaKey) return;
        const k = keyName(e);
        // Taste war schon belegt → dort freigeben
        for (const a of Object.keys(next)) if (next[a] === k) next[a] = "";
        next[recording] = k;
      }
      updateSettings({ shortcuts: next });
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  return (
    <>
      <Check
        label={t("Tastenkürzel aktivieren")}
        hint={t("wirken auf den hörbaren Stream bzw. den Stream im Vollbild")}
        checked={s.shortcutsEnabled}
        onChange={(v) => updateSettings({ shortcutsEnabled: v })}
      />
      <div className={`shortcut-list ${s.shortcutsEnabled ? "" : "disabled"}`}>
        {SHORTCUT_ACTIONS.map((a) => (
          <div key={a.id} className="shortcut-row">
            <span>{t(a.label)}</span>
            <button
              className={`kbd-btn ${recording === a.id ? "recording" : ""} ${map[a.id] ? "" : "unset"}`}
              disabled={!s.shortcutsEnabled}
              onClick={() => setRecording(recording === a.id ? null : a.id)}
              title={t("Klicken und neue Taste drücken")}
            >
              {recording === a.id ? t("Taste drücken…") : keyLabel(map[a.id])}
            </button>
          </div>
        ))}
        <div className="shortcut-row fixed">
          <span>{t("Kanalliste ein-/ausblenden")}</span>
          <kbd>{t("Strg")}+B</kbd>
        </div>
        <div className="shortcut-row fixed">
          <span>{t("Chat-Leiste ein-/ausblenden")}</span>
          <kbd>{t("Strg")}+J</kbd>
        </div>
        <div className="shortcut-row fixed">
          <span>{t("Vollbild beenden")}</span>
          <kbd>Esc</kbd>
        </div>
      </div>
      <div className="row">
        <p className="muted small" style={{ flex: 1 }}>
          {recording
            ? t("Esc: abbrechen · Entf/Rücktaste: Kürzel entfernen")
            : t("Auf eine Taste klicken, um sie zu ändern.")}
        </p>
        <button onClick={() => updateSettings({ shortcuts: {} })}>{t("Standard wiederherstellen")}</button>
      </div>
    </>
  );
}

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

/** Twitch Turbo: der offizielle Weg, ohne Werbung zu schauen */
function TurboSection({ loggedIn }: { loggedIn: boolean }) {
  const t = useT();
  const [turbo, setTurbo] = useState<boolean | null>(null);
  useEffect(() => {
    if (!loggedIn) {
      setTurbo(null);
      return;
    }
    api
      .gql<{ currentUser: { hasTurbo?: boolean } | null }>("query NativTurbo { currentUser { hasTurbo } }")
      .then((r) => setTurbo(r.currentUser?.hasTurbo ?? null))
      .catch(() => setTurbo(null));
  }, [loggedIn]);

  return (
    <section className="turbo-box">
      <div className="turbo-head">
        <Icon name="tv" size={22} />
        <h3>{t("Werbefrei schauen mit Twitch Turbo")}</h3>
      </div>
      {turbo ? (
        <p className="turbo-active">✓ {t("Turbo ist aktiv – MuffinTwitch läuft bei dir ohne Werbung.")}</p>
      ) : (
        <>
          <p>
            {t("Mit Twitch Turbo läuft MuffinTwitch komplett ohne Werbung – auf allen Kanälen, auch im Multiview.")}{" "}
            <b>{t("Das ist die beste Option:")}</b>{" "}
            {t("offiziell von Twitch, kein Risiko für dein Konto und es funktioniert dauerhaft – anders als Werbeblocker, die ständig kaputtgehen.")}
          </p>
          {!loggedIn && (
            <p className="muted small">{t("Wichtig: Melde dich in MuffinTwitch mit Twitch an (Einstellungen → Konto), damit Turbo in der App gilt.")}</p>
          )}
          <p className="muted small">{t("Tipp: Kanäle, die du abonniert hast, laufen auch ohne Turbo werbefrei.")}</p>
        </>
      )}
      <div className="row">
        <div className="spacer" />
        <button className={turbo ? "" : "primary"} onClick={() => openUrl("https://www.twitch.tv/turbo").catch(() => {})}>
          {turbo ? t("Turbo verwalten") : t("Twitch Turbo abonnieren")}
        </button>
      </div>
    </section>
  );
}

/** Updates: suchen, anzeigen, signiert installieren */
function UpdateSection() {
  const t = useT();
  const u = useUpdate();
  return (
    <div className="update-box">
      <div className="row">
        <span className="row-label">
          {u.kind === "idle" && t("Updates")}
          {u.kind === "checking" && t("Suche nach Updates…")}
          {u.kind === "none" && t("Du hast die neueste Version.")}
          {u.kind === "available" && t("Version {v} ist verfügbar!", { v: u.version })}
          {u.kind === "downloading" &&
            (u.percent === null ? t("Lade Update herunter…") : t("Lade Update herunter… {p} %", { p: u.percent }))}
          {u.kind === "installing" && t("Installiere – die App startet gleich neu…")}
          {u.kind === "error" && t("Update-Prüfung fehlgeschlagen")}
        </span>
        <div className="spacer" />
        {u.kind === "available" ? (
          u.canInstall ? (
            <button className="primary" onClick={() => installUpdate()}>
              {t("Jetzt aktualisieren")}
            </button>
          ) : (
            <button className="primary" onClick={() => openUrl("https://github.com/MuffinCody/MuffinTwitch/releases/latest").catch(() => {})}>
              {t("Zur Download-Seite")}
            </button>
          )
        ) : (
          <button
            disabled={u.kind === "checking" || u.kind === "downloading" || u.kind === "installing"}
            onClick={() => checkForUpdates()}
          >
            {t("Nach Updates suchen")}
          </button>
        )}
      </div>
      {u.kind === "downloading" && (
        <div className="update-progress">
          <div style={{ width: `${u.percent ?? 30}%` }} className={u.percent === null ? "indeterminate" : ""} />
        </div>
      )}
      {u.kind === "available" && !u.canInstall && (
        <p className="muted small">{t("Mit deb/rpm/Arch-Paketen installierst du Updates über die Download-Seite bzw. deinen Paketmanager.")}</p>
      )}
      {u.kind === "available" && u.notes && <pre className="update-notes">{u.notes}</pre>}
      {u.kind === "error" && <div className="error small">{u.message}</div>}
      <p className="muted small">{t("Updates sind signiert – die App installiert nur Versionen, deren Signatur zum eingebauten Schlüssel passt.")}</p>
    </div>
  );
}

export function SettingsDialog({ auth, initialTab, onClose, onAuthChanged }: Props) {
  const s = useSettings();
  const t = useT();
  const [tab, setTab] = useState<Tab>(initialTab ?? "general");
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(auth?.client_id ?? "");
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(!!auth?.app);
  const pollRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pollRef.current), []);

  const startAppLogin = async () => {
    setError(null);
    try {
      const d = await api.appLoginStart(clientId);
      setDevice(d);
      openUrl(d.verification_uri).catch(() => {});
      const deadline = Date.now() + d.expires_in * 1000;
      const poll = async () => {
        if (Date.now() > deadline) {
          setDevice(null);
          setError(t("Code abgelaufen – bitte erneut versuchen."));
          return;
        }
        try {
          const r = await api.appLoginPoll(d.device_code);
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
      pollRef.current = window.setTimeout(poll, Math.max(2, d.interval) * 1000);
    } catch (e) {
      setError(String(e));
    }
  };

  const appLogout = async () => {
    await api.appLogout();
    onAuthChanged();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const logout = async () => {
    await api.authLogout();
    onAuthChanged();
  };

  const webLogin = () => {
    setError(null);
    api.authWebLogin().catch((e) => setError(String(e)));
  };

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <h2>{t("Einstellungen")}</h2>
          {NAV.map((n) => (
            <button key={n.id} className={tab === n.id ? "on" : ""} onClick={() => setTab(n.id)}>
              <Icon name={n.icon} size={17} />
              {t(n.label)}
            </button>
          ))}
          <div className="spacer" />
          {version && <div className="settings-version">MuffinTwitch v{version}</div>}
        </nav>

        <div className="settings-body">
        <div className="modal-head">
          <h2>{t(NAV.find((n) => n.id === tab)!.label)}</h2>
          <button onClick={onClose} title={t("Schließen")}>✕</button>
        </div>

        {tab === "general" && (
          <>
            <TurboSection loggedIn={!!auth?.logged_in} />
            <section>
              <h3>{t("Sprache")} / Language</h3>
              <div className="seg lang-seg">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.id}
                    className={s.language === l.id ? "on" : ""}
                    onClick={() => updateSettings({ language: l.id as Lang })}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3>{t("Start")}</h3>
              <Check
                label={t("Zuletzt geöffnete Kanäle beim Start wieder öffnen")}
                checked={s.restoreChannels}
                onChange={(v) => updateSettings({ restoreChannels: v })}
              />
            </section>

            <section>
              <h3>{t("Gefolgte Kanäle")}</h3>
              <label className="row">
                <span className="row-label">{t("Automatisch aktualisieren")}</span>
                <select
                  value={s.followRefreshMin}
                  onChange={(e) => updateSettings({ followRefreshMin: Number(e.target.value) })}
                >
                  {[1, 2, 5, 10, 15, 30].map((m) => (
                    <option key={m} value={m}>
                      {t("alle {m} Min.", { m })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row">
                <span className="row-label">{t("Sortierung")}</span>
                <select
                  value={s.followSort}
                  onChange={(e) => updateSettings({ followSort: e.target.value as typeof s.followSort })}
                >
                  <option value="viewers">{t("Zuschauer")}</option>
                  <option value="recent">{t("Zuletzt gesehen")}</option>
                  <option value="recommended">{t("Empfohlen")}</option>
                </select>
              </label>
              <p className="muted small">{t("Mit ⟳ neben „Gefolgt · Live“ jederzeit sofort aktualisieren.")}</p>
            </section>

            <section>
              <h3>{t("Über")}</h3>
              <div className="row">
                <span className="row-label">MuffinTwitch {version && `v${version}`}</span>
                <div className="spacer" />
                <button onClick={() => openUrl("https://github.com/MuffinCody/MuffinTwitch").catch(() => {})}>GitHub</button>
              </div>
              <UpdateSection />
              <Check
                label={t("Beim Start automatisch nach Updates suchen")}
                checked={s.autoUpdateCheck}
                onChange={(v) => updateSettings({ autoUpdateCheck: v })}
              />
              <p className="muted small">{t("Inoffizielles Fanprojekt – steht in keiner Verbindung zu Twitch Interactive, Inc.")}</p>
            </section>
          </>
        )}

        {tab === "account" && (
          <section>
            {auth?.logged_in ? (
              <div className="account-row">
                <div>
                  {t("Angemeldet als")} <b>{auth.login}</b>
                  <div className="muted small">{t("Aktiv – gefolgte Kanäle, Chat, Kanalpunkte und Turbo/Abos ohne Werbung.")}</div>
                </div>
                <button onClick={logout}>{t("Abmelden")}</button>
              </div>
            ) : (
              <div className="account-row">
                <div>
                  <b>{t("twitch.tv-Login")}</b>
                  <div className="muted small">
                    {t("Ohne Login kannst du Streams schauen und den Chat lesen.")}{" "}
                    {t("Mit der normalen Twitch-Anmeldung kommen gefolgte Kanäle, Chat schreiben, Kanalpunkte und Turbo/Abo ohne Werbung dazu.")}
                  </div>
                </div>
                <button className="primary" onClick={webLogin}>
                  {t("Mit Twitch anmelden")}
                </button>
              </div>
            )}

            <h3 style={{ marginTop: 18 }}>{t("Kanalpunkte")}</h3>
            <Check
              label={t("Bonus-Truhe automatisch einsammeln")}
              hint={t("für alle geöffneten Kanäle")}
              checked={s.autoClaimPoints}
              onChange={(v) => updateSettings({ autoClaimPoints: v })}
            />

            <button className="link" style={{ marginTop: 14 }} onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? "▾" : "▸"} {t("Erweitert: eigene Twitch-App (optional)")}
            </button>

            {showAdvanced && (
              <div className="own-app">
                <p className="muted">
                  {t("Nicht nötig – alles Wichtige läuft über den normalen Login. Eine eigene Twitch-App bringt zusätzlich:")}
                </p>
                <ul className="own-app-benefits">
                  <li>
                    <b>{t("Flüstern")}</b> – {t("private Nachrichten an andere Nutzer (Nutzerkarte → ✉). Twitch erlaubt das nur über die offizielle Schnittstelle.")}
                  </li>
                  <li>
                    <b>{t("Ausweichweg")}</b> – {t("ändert Twitch seine Webseite, laden gefolgte Kanäle, Folgen-Status und eigene Emotes weiter über die offizielle Schnittstelle.")}
                  </li>
                </ul>
                {auth?.app ? (
                  <div className="account-row">
                    <div>
                      <b>{t("Eigene App verbunden")}</b>
                      <div className="muted small">
                        {t("als {name}", { name: auth.app_login ?? "?" })}
                        {auth.login && auth.app_login && auth.login !== auth.app_login && (
                          <> · {t("Achtung: anderes Konto als der twitch.tv-Login – geflüstert wird als {name}.", { name: auth.app_login })}</>
                        )}
                      </div>
                    </div>
                    <button onClick={appLogout}>{t("Trennen")}</button>
                  </div>
                ) : (
                  <>
                    <p className="muted small">
                      {t("So geht’s: Auf")}{" "}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          openUrl("https://dev.twitch.tv/console/apps/create");
                        }}
                      >
                        dev.twitch.tv
                      </a>{" "}
                      {t("eine App anlegen – Client-Typ")} <b>{t("„Öffentlich“")}</b>, OAuth-Redirect <code>http://localhost</code>
                      {t(" – und die Client-ID hier eintragen. Ein Client-Secret wird nicht gebraucht.")}
                    </p>
                    <div className="row">
                      <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client-ID" spellCheck={false} />
                      <button disabled={!clientId.trim() || !!device} onClick={startAppLogin}>
                        {t("Verbinden")}
                      </button>
                    </div>
                    {device && (
                      <div className="device">
                        {t("Im Browser bestätigen. Code:")} <span className="code">{device.user_code}</span>
                        <button onClick={() => openUrl(device.verification_uri)}>{t("Seite erneut öffnen")}</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </section>
        )}

        {tab === "chat" && (
          <>
            <section>
              <h3>{t("Darstellung")}</h3>
              <label className="row">
                <span className="row-label">{t("Schriftart")}</span>
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
              <Range label={t("Schriftgröße")} min={11} max={24} value={s.chatFontSize} format={(v) => `${v}px`} onChange={(v) => updateSettings({ chatFontSize: v })} />
              <Range label={t("Zeilenabstand")} min={1.2} max={2.2} step={0.1} value={s.chatLineSpacing} format={(v) => v.toFixed(1)} onChange={(v) => updateSettings({ chatLineSpacing: v })} />
              <Range label={t("Emote-Größe")} min={0.6} max={2} step={0.1} value={s.emoteScale} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateSettings({ emoteScale: v })} />
              <div className="font-preview" style={{ fontFamily: s.chatFontFamily, fontSize: s.chatFontSize, lineHeight: s.chatLineSpacing }}>
                <b style={{ color: "#a970ff" }}>{t("Beispiel")}</b>: {t("So sieht der Chat aus.")} Kappa 123
              </div>
              <Check label={t("Zeitstempel anzeigen")} checked={s.showTimestamps} onChange={(v) => updateSettings({ showTimestamps: v })} />
              <Check label={t("Zeilen abwechselnd hinterlegen")} checked={s.chatAltRows} onChange={(v) => updateSettings({ chatAltRows: v })} />
              <Check label={t("Badges anzeigen")} checked={s.showBadges} onChange={(v) => updateSettings({ showBadges: v })} />
              <Check label={t("7TV-Namensfarben (Paints)")} checked={s.show7tvPaints} onChange={(v) => updateSettings({ show7tvPaints: v })} />
            </section>

            <section>
              <h3>{t("Erwähnungen")}</h3>
              <Check label={t("Ton abspielen, wenn ich erwähnt werde")} checked={s.mentionSound} onChange={(v) => updateSettings({ mentionSound: v })} />
              <div className="row">
                <span className="row-label">{t("Lautstärke")}</span>
                <input type="range" min={0.05} max={1} step={0.05} value={s.mentionVolume} onChange={(e) => updateSettings({ mentionVolume: Number(e.target.value) })} />
                <button onClick={() => playMentionSound(s.mentionVolume)}>Test</button>
              </div>
              <label className="row">
                <span className="row-label">{t("Weitere Wörter")}</span>
                <input
                  value={s.highlightWords}
                  onChange={(e) => updateSettings({ highlightWords: e.target.value })}
                  placeholder={t("z. B. Spitzname, Giveaway (kommagetrennt)")}
                  style={{ flex: 1 }}
                />
              </label>
            </section>

            <section>
              <h3>{t("Geschwindigkeit")}</h3>
              <Range
                label={t("Max. Nachrichten/s")}
                min={0}
                max={30}
                value={s.chatMaxRate}
                format={(v) => (v === 0 ? t("unbegrenzt") : `${v}/s`)}
                onChange={(v) => updateSettings({ chatMaxRate: v })}
              />
              <p className="muted small">{t("Macht schnelle Chats langsamer. Bei zu viel Rückstau werden ältere Nachrichten übersprungen.")}</p>
              <Range
                label={t("Verzögerung")}
                min={0}
                max={15}
                step={0.5}
                value={s.chatDelay}
                format={(v) => (v === 0 ? t("aus") : `${v}s`)}
                onChange={(v) => updateSettings({ chatDelay: v })}
              />
              <p className="muted small">{t("Zeigt Nachrichten später an – passend zur Verzögerung des Streams (keine Spoiler).")}</p>
              <Check label={t("Chat pausieren, solange die Maus darüber ist")} checked={s.pauseOnHover} onChange={(v) => updateSettings({ pauseOnHover: v })} />
            </section>

            <section>
              <h3>{t("Verlauf")}</h3>
              <Check
                label={t("Beim Öffnen die letzten Nachrichten laden")}
                hint={t("über recent-messages.robotty.de")}
                checked={s.loadChatHistory}
                onChange={(v) => updateSettings({ loadChatHistory: v })}
              />
              <Check
                label={t("Im Nutzer-Fenster ältere Nachrichten zeigen")}
                hint={t("aus öffentlichen Logs von logs.ivr.fi, nicht für jeden Kanal verfügbar")}
                checked={s.loadUserLogs}
                onChange={(v) => updateSettings({ loadUserLogs: v })}
              />
            </section>
          </>
        )}

        {tab === "player" && (
          <>
          <section>
            <h3>{t("Wiedergabe")}</h3>
            <Check label={t("Niedrige Latenz")} hint={t("holt Verzögerung automatisch auf")} checked={s.lowLatency} onChange={(v) => updateSettings({ lowLatency: v })} />
            <Check label={t("Multiview: nur den angeklickten Stream hörbar")} checked={s.audioFocus} onChange={(v) => updateSettings({ audioFocus: v })} />
            <label className="row">
              <span className="row-label">{t("Standardqualität")}</span>
              <select value={s.defaultQuality} onChange={(e) => updateSettings({ defaultQuality: e.target.value as "auto" | "source" })}>
                <option value="auto">{t("Auto (an Kachelgröße angepasst)")}</option>
                <option value="source">{t("Source (beste)")}</option>
              </select>
            </label>
            <p className="muted small">
              {t("Tipp: „Auto“ schont im Multiview CPU/GPU deutlich. Änderungen gelten für neu geöffnete Streams.")}
            </p>
          </section>
          <section>
            <h3>{t("Tastenkürzel")}</h3>
            <ShortcutEditor />
          </section>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
