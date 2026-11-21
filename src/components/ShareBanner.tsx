import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "../lib/i18n";

interface Resub {
  id: string;
  token: string;
  months: number;
  streak: number;
}

interface Milestone {
  id: string;
  category: string;
  value: number;
}

interface Notifications {
  channel_id: string;
  resub: Resub | null;
  milestones: Milestone[];
}

const DISMISSED_KEY = "nativ.dismissedShares";
const REFRESH_MS = 5 * 60_000;

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function saveDismissed(s: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* ignore */
  }
}

const dismissed = loadDismissed();

/**
 * Hinweis über dem Chat: Abo-Jubiläum oder Anschau-Serie teilen – wie auf twitch.tv.
 * Erscheint nur, wenn Twitch für diesen Kanal gerade etwas Teilbares meldet.
 */
export function ShareBanner({ channel }: { channel: string }) {
  const t = useT();
  const [data, setData] = useState<Notifications | null>(null);
  const [message, setMessage] = useState("");
  const [withStreak, setWithStreak] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setMessage("");
    setError(null);
    const load = () =>
      invoke<Notifications>("chat_notifications", { channel })
        .then((d) => !cancelled && setData(d))
        .catch(() => {});
    load();
    const iv = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [channel]);

  if (!data) return null;
  const resub = data.resub && !dismissed.has(`r:${data.resub.id}`) ? data.resub : null;
  const milestone = data.milestones.find((m) => !dismissed.has(`m:${m.id}`)) ?? null;
  if (!resub && !milestone) return null;

  const dismiss = (key: string) => {
    dismissed.add(key);
    saveDismissed(dismissed);
    setError(null);
    setTick((n) => n + 1);
  };

  const fail = (e: unknown) => {
    const msg = String(e);
    if (/integrity/i.test(msg)) {
      // Twitch verlangt seinen Integritäts-Nachweis → auf der Webseite teilen
      openUrl(`https://www.twitch.tv/${channel}`).catch(() => {});
      setError(t("Twitch erlaubt das nur auf der Webseite – im Browser geöffnet"));
    } else {
      setError(msg);
    }
  };

  const shareResub = async (r: Resub) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("share_resub", { channel, token: r.token, includeStreak: withStreak && r.streak > 0, message });
      dismiss(`r:${r.id}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const shareMilestone = async (m: Milestone) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("share_milestone", { channelId: data.channel_id, milestoneId: m.id });
      dismiss(`m:${m.id}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (resub) {
    return (
      <div className="share-banner">
        <div className="share-head">
          <span className="share-icon">🎉</span>
          <div>
            <b>{t("Teile dein Abo-Jubiläum")}</b>
            <div className="muted small">
              {t("{n} Monate abonniert", { n: resub.months })}
              {resub.streak > 0 && ` · ${t("{n} Monate am Stück", { n: resub.streak })}`}
            </div>
          </div>
        </div>
        <input
          value={message}
          maxLength={500}
          placeholder={t("Nachricht (optional)")}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && shareResub(resub)}
        />
        <div className="share-actions">
          {resub.streak > 0 && (
            <label className="share-check">
              <input type="checkbox" checked={withStreak} onChange={(e) => setWithStreak(e.target.checked)} />
              {t("Serie anzeigen")}
            </label>
          )}
          <div className="spacer" />
          <button disabled={busy} onClick={() => dismiss(`r:${resub.id}`)}>
            {t("Nicht jetzt")}
          </button>
          <button className="primary" disabled={busy} onClick={() => shareResub(resub)}>
            {t("Im Chat teilen")}
          </button>
        </div>
        {error && <div className="error small">{error}</div>}
      </div>
    );
  }

  const m = milestone!;
  const isStreak = /streak/i.test(m.category);
  return (
    <div className="share-banner">
      <div className="share-head">
        <span className="share-icon">🔥</span>
        <div>
          <b>{isStreak ? t("Teile deine Anschau-Serie") : t("Teile deinen Meilenstein")}</b>
          <div className="muted small">
            {isStreak ? t("{n} Streams in Folge geschaut", { n: m.value }) : `${m.category} · ${m.value}`}
          </div>
        </div>
      </div>
      <div className="share-actions">
        <div className="spacer" />
        <button disabled={busy} onClick={() => dismiss(`m:${m.id}`)}>
          {t("Nicht jetzt")}
        </button>
        <button className="primary" disabled={busy} onClick={() => shareMilestone(m)}>
          {t("Im Chat teilen")}
        </button>
      </div>
      {error && <div className="error small">{error}</div>}
    </div>
  );
}
