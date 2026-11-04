import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { updateSettings, useSettings, getSettings } from "../lib/settings";
import { Icon } from "./Icon";
import { openUrl as openExternal } from "@tauri-apps/plugin-opener";

interface Benefit {
  id: string;
  name: string;
  imageAssetURL: string;
}
interface TimeDrop {
  id: string;
  name: string;
  requiredMinutesWatched: number;
  benefitEdges: { benefit: Benefit }[];
  self: { hasPreconditionsMet: boolean; currentMinutesWatched: number; isClaimed: boolean; dropInstanceID: string | null } | null;
}
interface Campaign {
  id: string;
  name: string;
  status?: string;
  endAt: string;
  accountLinkURL?: string;
  game: { id: string; displayName: string; boxArtURL: string } | null;
  self: { isAccountConnected: boolean } | null;
  timeBasedDrops?: TimeDrop[];
}

const POLL_MS = 5 * 60_000;

/** Twitch blockiert Einsammeln außerhalb der eigenen Webseite (integrity check) */
let dropsBlocked = false;

/** Twitch-Drops-Seite im Standard-Browser öffnen */
function openDrops(page: "inventory" | "campaigns") {
  return openExternal(`https://www.twitch.tv/drops/${page}`);
}

function claimable(d: TimeDrop) {
  return !!d.self && !d.self.isClaimed && !!d.self.dropInstanceID && d.self.currentMinutesWatched >= d.requiredMinutesWatched;
}

function endsIn(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "beendet";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `noch ${Math.floor(h / 24)} Tage`;
  if (h >= 1) return `noch ${h} Std.`;
  return `noch ${Math.max(1, Math.floor(ms / 60_000))} Min.`;
}

function boxArt(url: string) {
  return url.replace(/\d+x\d+/, "52x72").replace("{width}", "52").replace("{height}", "72");
}

/** Drops-Symbol oben rechts (neben dem Benutzernamen) mit Inventar-Popup. */
export function DropsButton() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<Campaign[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [blocked, setBlocked] = useState(dropsBlocked);
  const [campaignsUnavailable, setCampaignsUnavailable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const claim = useCallback(async (d: TimeDrop, silent = false) => {
    if (!d.self?.dropInstanceID) return false;
    try {
      await invoke("claim_drop", { dropInstanceId: d.self.dropInstanceID });
      if (!silent) setMsg(`„${d.benefitEdges[0]?.benefit.name ?? d.name}“ eingesammelt!`);
      return true;
    } catch (e) {
      const m = String(e);
      if (/integrity/i.test(m)) {
        dropsBlocked = true;
        setBlocked(true);
      } else setError(m);
      return false;
    }
  }, []);

  const loadInventory = useCallback(async () => {
    try {
      const inv = await invoke<any>("drops_inventory");
      const list: Campaign[] = inv?.inventory?.dropCampaignsInProgress ?? [];
      setProgress(list);
      setError(null);
      // Fertige Drops automatisch einsammeln
      if (getSettings().autoClaimDrops && !dropsBlocked) {
        let claimedAny = false;
        for (const c of list) for (const d of c.timeBasedDrops ?? []) if (claimable(d) && (await claim(d, true))) claimedAny = true;
        if (claimedAny) {
          setMsg("Fertige Drops wurden automatisch eingesammelt.");
          const again = await invoke<any>("drops_inventory");
          setProgress(again?.inventory?.dropCampaignsInProgress ?? []);
        }
      }
    } catch (e) {
      setError(String(e));
    }
  }, [claim]);

  // Im Hintergrund regelmäßig prüfen (für Zähler + Auto-Einsammeln)
  useEffect(() => {
    loadInventory();
    const t = window.setInterval(loadInventory, POLL_MS);
    return () => window.clearInterval(t);
  }, [loadInventory]);

  // Beim Öffnen frisch laden (+ alle Kampagnen)
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMsg(null);
    Promise.all([
      loadInventory(),
      invoke<any>("drops_campaigns")
        .then((c) => setCampaigns((c?.dropCampaigns ?? []).filter((x: Campaign) => x.status === "ACTIVE")))
        .catch(() => setCampaignsUnavailable(true)),
    ]).finally(() => setLoading(false));
  }, [open, loadInventory]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const drops = progress.flatMap((c) => c.timeBasedDrops ?? []);
  const ready = drops.filter(claimable).length;
  const active = drops.filter((d) => d.self && !d.self.isClaimed).length;
  const inProgressIds = new Set(progress.map((c) => c.id));
  const others = campaigns.filter((c) => !inProgressIds.has(c.id));

  return (
    <div className="drops" ref={ref}>
      <button
        className={`icon-btn drops-btn ${open ? "on" : ""}`}
        title={ready ? `${ready} Drop(s) bereit zum Einsammeln` : active ? `${active} Drop(s) in Arbeit` : "Drops"}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="gift" size={20} />
        {(ready > 0 || active > 0) && <span className={`drops-count ${ready ? "ready" : ""}`}>{ready || active}</span>}
      </button>

      {open && (
        <div className="drops-menu">
          <div className="drops-head">
            <b>Drops</b>
            <div className="spacer" />
            <label className="drops-auto" title="Fertige Drops automatisch einsammeln" style={blocked ? { display: "none" } : undefined}>
              Auto
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.autoClaimDrops}
                  onChange={(e) => updateSettings({ autoClaimDrops: e.target.checked })}
                />
                <span />
              </span>
            </label>
          </div>

          <div className="drops-body">
            {loading && progress.length === 0 && <div className="spinner center" />}
            {msg && <div className="ok small drops-msg">{msg}</div>}
            {error && <div className="error small drops-msg">{error}</div>}
            {blocked && (
              <div className="pm-info drops-msg">
                Twitch lässt Drops nur über die eigene Webseite einsammeln („integrity check“). „Einsammeln“
                öffnet dein Drops-Inventar von Twitch in deinem Browser.
              </div>
            )}

            <div className="section-title">In Arbeit</div>
            {!loading && progress.length === 0 && (
              <div className="hint">Keine Drops in Arbeit. Schau einen Stream mit aktivierten Drops.</div>
            )}
            {progress.map((c) => (
              <div key={c.id} className="drop-campaign">
                <div className="drop-campaign-head">
                  {c.game?.boxArtURL && <img className="drop-art" src={boxArt(c.game.boxArtURL)} alt="" />}
                  <div className="entry-text">
                    <div className="entry-name">{c.game?.displayName ?? c.name}</div>
                    <div className="entry-game">
                      {c.name} · {endsIn(c.endAt)}
                    </div>
                    {c.self && !c.self.isAccountConnected && (
                      <button className="link small warn" onClick={() => c.accountLinkURL && openExternal(c.accountLinkURL)}>
                        ⚠ Konto nicht verknüpft – verknüpfen
                      </button>
                    )}
                  </div>
                </div>
                {(c.timeBasedDrops ?? []).map((d) => {
                  const b = d.benefitEdges[0]?.benefit;
                  const cur = Math.min(d.self?.currentMinutesWatched ?? 0, d.requiredMinutesWatched);
                  const pct = d.requiredMinutesWatched ? Math.round((cur / d.requiredMinutesWatched) * 100) : 0;
                  return (
                    <div key={d.id} className={`drop ${d.self?.isClaimed ? "claimed" : ""}`}>
                      {b?.imageAssetURL ? <img src={b.imageAssetURL} alt="" /> : <div className="drop-ph" />}
                      <div className="drop-info">
                        <div className="drop-name">{b?.name ?? d.name}</div>
                        {d.self?.isClaimed ? (
                          <div className="muted small">✓ Eingesammelt</div>
                        ) : (
                          <>
                            <div className="drop-bar">
                              <div style={{ width: `${pct}%` }} />
                            </div>
                            <div className="muted small">
                              {cur} / {d.requiredMinutesWatched} Min. ({pct} %)
                            </div>
                          </>
                        )}
                      </div>
                      {claimable(d) && (
                        <button className="primary small-btn" onClick={async () => {
                            if (blocked) {
                              openDrops("inventory");
                              return;
                            }
                            if (await claim(d)) await loadInventory();
                            else if (dropsBlocked) openDrops("inventory");
                          }}>
                          Einsammeln
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {campaignsUnavailable && (
              <>
                <div className="section-title">Weitere Kampagnen</div>
                <button className="link small" onClick={() => openDrops("campaigns")}>
                  Alle aktiven Kampagnen auf Twitch ansehen ↗
                </button>
              </>
            )}
            {others.length > 0 && (
              <>
                <div className="section-title">Weitere Kampagnen ({others.length})</div>
                {(showAll ? others : others.slice(0, 8)).map((c) => (
                  <div key={c.id} className="drop-campaign-row" title={c.name}>
                    {c.game?.boxArtURL && <img className="drop-art small" src={boxArt(c.game.boxArtURL)} alt="" />}
                    <div className="entry-text">
                      <div className="entry-name">{c.game?.displayName ?? c.name}</div>
                      <div className="entry-game">
                        {c.name} · {endsIn(c.endAt)}
                        {c.self && !c.self.isAccountConnected ? " · nicht verknüpft" : ""}
                      </div>
                    </div>
                  </div>
                ))}
                {!showAll && others.length > 8 && (
                  <button className="link small" onClick={() => setShowAll(true)}>
                    Alle anzeigen
                  </button>
                )}
              </>
            )}
          </div>

          <div className="drops-foot">
            <button className="link small" onClick={() => openDrops("inventory")}>
              Inventar auf twitch.tv ↗
            </button>
            <button className="link small" onClick={() => openDrops("campaigns")}>
              Alle Kampagnen ↗
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
