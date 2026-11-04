import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { points, usePoints, formatPoints, isIntegrityError } from "../lib/points";
import { updateSettings, useSettings } from "../lib/settings";
import { Icon } from "./Icon";

interface Reward {
  id: string;
  title: string;
  cost: number;
  prompt: string | null;
  isUserInputRequired: boolean;
  isEnabled: boolean;
  isPaused: boolean;
  isInStock: boolean;
  isSubOnly?: boolean;
  backgroundColor: string | null;
  cooldownExpiresAt: string | null;
  image: { url: string; url2x: string } | null;
  defaultImage: { url: string; url2x: string } | null;
}

interface MenuData {
  id: string;
  displayName: string;
  channel: {
    communityPointsSettings: {
      name: string | null;
      image: { url: string; url2x: string } | null;
      customRewards: Reward[];
    } | null;
  };
}

// Menüdaten zwischenspeichern (Symbol/Name auch im Badge nutzen)
const cache = new Map<string, MenuData>();
export function pointsIcon(channel: string): string | undefined {
  return cache.get(channel)?.channel?.communityPointsSettings?.image?.url;
}

interface Props {
  channel: string;
  onClose(): void;
}

export function PointsMenu({ channel, onClose }: Props) {
  const st = usePoints(channel);
  const settings = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<MenuData | null>(cache.get(channel) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Reward | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<MenuData>("points_menu", { login: channel })
      .then((d) => {
        if (cancelled) return;
        cache.set(channel, d);
        setData(d);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [channel]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest(".points")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const cps = data?.channel?.communityPointsSettings;
  const name = cps?.name || "Kanalpunkte";
  const balance = st?.balance ?? 0;
  const rewards = (cps?.customRewards ?? [])
    .filter((r) => r.isEnabled)
    .sort((a, b) => a.cost - b.cost);

  const unavailable = (r: Reward): string | null => {
    if (r.isPaused) return "Pausiert";
    if (!r.isInStock) return "Ausverkauft";
    if (r.cooldownExpiresAt && new Date(r.cooldownExpiresAt).getTime() > Date.now()) return "Cooldown";
    if (balance < r.cost) return null; // wird separat angezeigt
    return null;
  };

  const redeem = async () => {
    if (!selected || !data) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("redeem_reward", {
        channelId: data.id,
        rewardId: selected.id,
        cost: selected.cost,
        title: selected.title,
        prompt: selected.prompt,
        textInput: selected.isUserInputRequired ? text : null,
      });
      setDone(`„${selected.title}“ eingelöst!`);
      setSelected(null);
      setText("");
      window.setTimeout(() => points.poll(channel), 800);
    } catch (e) {
      const msg = String(e);
      if (isIntegrityError(msg)) {
        points.blocked = true;
        setSelected(null);
        setError(null);
        openChat();
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const blocked = points.blocked || isIntegrityError(st?.error);
  function openChat() {
    points.openTwitchChat(channel).catch((e) => setError(String(e)));
  }

  const img = (r: Reward) => r.image?.url ?? r.defaultImage?.url;

  return (
    <div className="points-menu" ref={ref}>
      <div className="pm-head">
        {cps?.image?.url ? <img src={cps.image.url} srcSet={`${cps.image.url} 1x, ${cps.image.url2x} 2x`} alt="" /> : <Icon name="points" size={22} />}
        <div className="pm-title">
          <div className="muted small">{name}</div>
          <div className="pm-balance">{balance.toLocaleString("de-DE")}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Schließen">
          <Icon name="close" />
        </button>
      </div>

      <div className="pm-bonus">
        <Icon name="gift" size={16} />
        <div className="pm-bonus-text">
          {st?.claimId ? (
            <>Bonus verfügbar!</>
          ) : blocked ? (
            <>Bonus-Truhe im Twitch-Chat einsammeln</>
          ) : (
            <>
              Bonus-Truhe {settings.autoClaimPoints ? "wird automatisch eingesammelt" : "manuell einsammeln"}
              {st?.claimedCount ? ` · ${st.claimedCount}× diese Sitzung` : ""}
            </>
          )}
        </div>
        {st?.claimId ? (
          <button className="primary small-btn" onClick={() => (blocked ? openChat() : points.claim(channel))}>
            Einsammeln
          </button>
        ) : (
          !blocked && (
            <label className="switch" title="Automatisch einsammeln">
              <input
                type="checkbox"
                checked={settings.autoClaimPoints}
                onChange={(e) => updateSettings({ autoClaimPoints: e.target.checked })}
              />
              <span />
            </label>
          )
        )}
      </div>

      {blocked ? (
        <div className="pm-info">
          Twitch lässt Truhe und Belohnungen nur über die eigene Webseite zu („integrity check“). Im
          Twitch-Chat in deinem Browser klickst du sie direkt an.
          <button className="small-btn" onClick={openChat}>
            Twitch-Chat im Browser öffnen ↗
          </button>
        </div>
      ) : (
        st?.error && <div className="error small pm-msg pm-err">{st.error}</div>
      )}

      {selected ? (
        <div className="pm-redeem">
          <div className="pm-reward-big" style={{ background: selected.backgroundColor ?? undefined }}>
            {img(selected) && <img src={img(selected)} alt="" />}
          </div>
          <b>{selected.title}</b>
          {selected.prompt && <p className="muted small">{selected.prompt}</p>}
          {selected.isUserInputRequired && (
            <textarea
              autoFocus
              value={text}
              maxLength={200}
              placeholder="Deine Nachricht…"
              onChange={(e) => setText(e.target.value)}
            />
          )}
          <div className="row">
            <button onClick={() => setSelected(null)}>Zurück</button>
            <div className="spacer" />
            <button
              className="primary"
              disabled={busy || balance < selected.cost || (selected.isUserInputRequired && !text.trim())}
              onClick={redeem}
            >
              Einlösen für {formatPoints(selected.cost)}
            </button>
          </div>
        </div>
      ) : (
        <div className="pm-rewards">
          {!data && !error && <div className="spinner center" />}
          {data && rewards.length === 0 && <div className="hint">Dieser Kanal hat keine eigenen Belohnungen.</div>}
          {rewards.map((r) => {
            const why = unavailable(r);
            const tooExpensive = balance < r.cost;
            return (
              <button
                key={r.id}
                className={`pm-reward ${why || tooExpensive ? "disabled" : ""}`}
                disabled={!!why}
                title={r.prompt ?? r.title}
                onClick={() => {
                  setDone(null);
                  setError(null);
                  setSelected(r);
                }}
              >
                <div className="pm-reward-img" style={{ background: r.backgroundColor ?? undefined }}>
                  {img(r) && <img src={img(r)} alt="" loading="lazy" />}
                  {why && <span className="pm-tag">{why}</span>}
                </div>
                <div className="pm-reward-title">{r.title}</div>
                <div className="pm-cost">
                  <Icon name="points" size={12} /> {formatPoints(r.cost)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {done && <div className="ok small pm-msg">{done}</div>}
      {error && <div className="error small pm-msg">{error}</div>}
    </div>
  );
}
