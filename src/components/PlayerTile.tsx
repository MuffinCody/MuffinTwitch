import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPlayer, type PlayerHandle, type PlayerStatus, type QualityOption } from "../lib/player";
import type { HelixStream, HelixUser } from "../lib/api";
import { useSettings, updateSettings } from "../lib/settings";
import { Icon } from "./Icon";
import { t, locale } from "../lib/i18n";
import { playerBus, type PlayerAction } from "../lib/shortcuts";
import { toggleFollow, useFollow } from "../lib/follows";

interface Props {
  login: string;
  style: CSSProperties;
  audible: boolean;
  focused: boolean;
  multi: boolean;
  info?: HelixStream;
  isFavorite: boolean;
  /** Ändert sich beim (Ab-)Melden → Stream mit neuem Token laden */
  authKey: string;
  fullscreen: boolean;
  onFullscreen(): void;
  /** Stream Together: Partner dieses Streams */
  together?: HelixUser[];
  onOpenPartner(login: string): void;
  /** Twitch-ID des Kanals (für Folgen) */
  channelId?: string;
  onAudio(): void;
  onClose(): void;
  onFocus(): void;
  onChat(): void;
  onToggleFavorite(): void;
}

function uptime(since: string) {
  const s = Math.max(0, (Date.now() - new Date(since).getTime()) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function PlayerTile(p: Props) {
  const settings = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const [status, setStatus] = useState<PlayerStatus>({ kind: "loading" });
  const [levels, setLevels] = useState<QualityOption[]>([]);
  const [level, setLevel] = useState(-1);
  const [reload, setReload] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [volume, setVolume] = useState(settings.volume);
  const [userMuted, setUserMuted] = useState(false);
  const [paused, setPaused] = useState(false);

  // Player erzeugen / neu laden
  useEffect(() => {
    const video = videoRef.current!;
    let cancelled = false;
    let handle: PlayerHandle | null = null;
    createPlayer(video, p.login, {
      lowLatency: settings.lowLatency,
      preferSource: settings.defaultQuality === "source",
      onStatus: (s) => !cancelled && setStatus(s),
      onLevels: (l, cur) => {
        if (cancelled) return;
        setLevels(l);
        setLevel(cur);
      },
      onAutoplayMuted: () => !cancelled && setAutoplayBlocked(true),
    })
      .then((h) => {
        if (cancelled) h.destroy();
        else handle = playerRef.current = h;
      })
      .catch((e) => !cancelled && setStatus({ kind: "error", message: String(e) }));
    return () => {
      cancelled = true;
      handle?.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.login, reload, p.authKey]);

  // Offline / Fehler → regelmäßig erneut versuchen
  useEffect(() => {
    if (status.kind !== "offline" && status.kind !== "error") return;
    const t = window.setTimeout(() => setReload((r) => r + 1), status.kind === "offline" ? 60000 : 8000);
    return () => window.clearTimeout(t);
  }, [status]);

  // Lautstärke / Audio-Fokus – Video-Element immer exakt wie die Anzeige einstellen
  const syncAudio = () => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = autoplayBlocked || userMuted || !p.audible;
  };
  useEffect(syncAudio, [volume, userMuted, p.audible, autoplayBlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Nach einer Autoplay-Sperre: Klick des Nutzers gibt den Ton frei */
  const unlockAudio = () => {
    setAutoplayBlocked(false);
    setUserMuted(false);
    if (!p.audible) p.onAudio();
    const v = videoRef.current;
    if (v) {
      v.muted = false;
      v.play().catch(() => {});
    }
  };

  // Nach Pausieren auf Live-Kante springen
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.buffered.length) v.currentTime = v.buffered.end(v.buffered.length - 1) - 1;
      v.play().catch(() => {});
    } else v.pause();
  };

  const fullscreen = () => p.onFullscreen();

  // Einzelklick erst nach kurzer Wartezeit auswerten – sonst pausiert ein Doppelklick
  // den Stream zweimal und springt an die Live-Kante (= Ruckler/Neupuffern)
  const clickTimer = useRef<number | undefined>(undefined);
  const onVideoClick = () => {
    if (p.multi && !p.fullscreen) return;
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(togglePlay, 260);
  };
  const onDouble = () => {
    window.clearTimeout(clickTimer.current);
    fullscreen();
  };
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);

  const effectiveMuted = autoplayBlocked || userMuted || !p.audible;

  // Steuerelemente nach kurzer Inaktivität ausblenden (wie bei YouTube)
  const [idle, setIdle] = useState(false);
  const [menu, setMenu] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const wake = () => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2500);
  };
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  // Kurze Einblendung mitten im Bild (Tastenkürzel, Folgen …)
  const [osd, setOsd] = useState<{ text: string; icon?: string; n: number } | null>(null);
  const osdTimer = useRef<number | undefined>(undefined);
  const showOsd = (text: string, icon?: string, ms = 900) => {
    setOsd((o) => ({ text, icon, n: (o?.n ?? 0) + 1 }));
    window.clearTimeout(osdTimer.current);
    osdTimer.current = window.setTimeout(() => setOsd(null), ms);
  };
  useEffect(() => () => window.clearTimeout(osdTimer.current), []);

  // Folgen
  const follow = useFollow(p.channelId);
  const [confirmUnfollow, setConfirmUnfollow] = useState(false);
  useEffect(() => {
    if (!confirmUnfollow) return;
    const tm = window.setTimeout(() => setConfirmUnfollow(false), 3000);
    return () => window.clearTimeout(tm);
  }, [confirmUnfollow]);
  const onFollowClick = async () => {
    if (!p.channelId || follow.busy) return;
    if (follow.following && !confirmUnfollow) {
      setConfirmUnfollow(true);
      return;
    }
    setConfirmUnfollow(false);
    const name = p.info?.user_name ?? p.login;
    const wasFollowing = !!follow.following;
    const r = await toggleFollow(p.channelId, p.login);
    if (r === "ok") showOsd(wasFollowing ? t("{name} entfolgt", { name }) : t("Du folgst jetzt {name}", { name }), wasFollowing ? "heart-outline" : "heart", 1800);
    else if (r === "browser") showOsd(t("Twitch erlaubt das nur auf der Webseite – im Browser geöffnet"), "heart-outline", 3500);
    else showOsd(t("Folgen fehlgeschlagen"), undefined, 3000);
  };

  const toggleMute = () => {
    if (autoplayBlocked) {
      unlockAudio();
      return;
    }
    if (!p.audible) {
      p.onAudio();
      setUserMuted(false);
    } else setUserMuted((m) => !m);
  };

  const goLive = () => {
    const v = videoRef.current;
    if (v?.buffered.length) v.currentTime = v.buffered.end(v.buffered.length - 1) - 1;
    v?.play().catch(() => {});
  };

  const changeVolume = (delta: number) => {
    const v = Math.round(Math.max(0, Math.min(1, (effectiveMuted ? 0 : volume) + delta)) * 100) / 100;
    setVolume(v);
    setUserMuted(false);
    setAutoplayBlocked(false);
    if (!p.audible) p.onAudio();
    updateSettings({ volume: v });
    showOsd(`${Math.round(v * 100)} %`, v === 0 ? "volume-off" : v > 0.5 ? "volume-high" : "volume-low");
  };

  // Tastenkürzel (App schickt die Befehle an den hörbaren / Vollbild-Stream)
  const commandRef = useRef<(a: PlayerAction) => void>(() => {});
  commandRef.current = (a) => {
    const v = videoRef.current;
    wake();
    switch (a) {
      case "playPause":
        showOsd(v?.paused ? t("Abspielen") : t("Pause"), v?.paused ? "play" : "pause");
        togglePlay();
        break;
      case "mute": {
        const willMute = !effectiveMuted;
        toggleMute();
        showOsd(willMute ? t("Stumm") : `${Math.round(volume * 100)} %`, willMute ? "volume-off" : "volume-high");
        break;
      }
      case "volumeUp":
        changeVolume(0.05);
        break;
      case "volumeDown":
        changeVolume(-0.05);
        break;
      case "live":
        goLive();
        showOsd("LIVE");
        break;
      case "reload":
        setReload((r) => r + 1);
        showOsd(t("Neu laden"), "refresh");
        break;
    }
  };
  useEffect(() => playerBus.on((login, a) => login === p.login && commandRef.current(a)), [p.login]);

  const currentLabel = levels.find((l) => l.index === level)?.label ?? "Auto";
  const showControls = !idle || menu || paused || status.kind !== "playing";

  return (
    <div
      ref={tileRef}
      className={`tile ${p.focused ? "focused" : ""} ${p.audible && p.multi ? "audible" : ""} ${showControls ? "" : "idle"}`}
      style={p.style}
      onDoubleClick={onDouble}
      onMouseMove={wake}
      onMouseLeave={() => {
        setIdle(true);
        setMenu(false);
      }}
      onMouseDown={() => p.multi && !p.audible && p.onAudio()}
    >
      <video
        ref={videoRef}
        playsInline
        autoPlay
        onPause={() => setPaused(true)}
        onPlay={() => setPaused(false)}
        onPlaying={syncAudio}
        onClick={onVideoClick}
      />

      {autoplayBlocked && p.audible && status.kind === "playing" && (
        <button
          className="unmute-hint"
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={unlockAudio}
        >
          <Icon name="volume-off" size={18} /> {t("Klicken für Ton")}
        </button>
      )}

      {status.kind !== "playing" && (
        <div className="tile-status">
          {status.kind === "loading" && <div className="spinner" />}
          {status.kind === "offline" && (
            <>
              {t("{name} ist offline", { name: p.login })}
              <small>{t("Wird jede Minute erneut geprüft")}</small>
            </>
          )}
          {status.kind === "error" && (
            <>
              {t("Fehler beim Laden")}
              <small>{t(status.message)}</small>
              <button onClick={() => setReload((r) => r + 1)}>{t("Erneut versuchen")}</button>
            </>
          )}
        </div>
      )}

      {osd && (
        <div key={osd.n} className="osd">
          {osd.icon && <Icon name={osd.icon} size={22} />}
          <span>{osd.text}</span>
        </div>
      )}

      {p.together && p.together.length > 0 && (
        <div className="together-badge" title={t("Streamt gemeinsam mit {names}", { names: p.together.map((u) => u.display_name).join(", ") })}>
          {p.together.slice(0, 4).map((u) => (
            <img key={u.id} src={u.profile_image_url} alt="" />
          ))}
          <span>{t("Gemeinsam")}</span>
        </div>
      )}

      <div className="tile-top">
        <div className="tile-title">
          <b>{p.info?.user_name ?? p.login}</b>
          {p.info && (
            <span className="meta">
              {p.info.game_name} · {t("{n} Zuschauer", { n: p.info.viewer_count.toLocaleString(locale()) })} · {uptime(p.info.started_at)}
            </span>
          )}
          {p.info?.title && <div className="stream-title">{p.info.title}</div>}
          {p.together && p.together.length > 0 && (
            <div className="together" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <span className="together-label">{t("Gemeinsam mit")}</span>
              {p.together.map((u) => (
                <button
                  key={u.id}
                  className="together-chip"
                  title={t("{name} zum Multiview hinzufügen", { name: u.display_name })}
                  onClick={() => p.onOpenPartner(u.login)}
                >
                  <img src={u.profile_image_url} alt="" />
                  {u.display_name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="tile-actions" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {follow.enabled && follow.following !== undefined && (
            <button
              className={`pbtn follow-btn ${follow.following ? "following" : ""} ${confirmUnfollow ? "confirm" : ""}`}
              disabled={follow.busy}
              title={
                confirmUnfollow
                  ? t("Nochmal klicken zum Entfolgen")
                  : follow.following
                    ? t("Du folgst {name} – klicken zum Entfolgen", { name: p.info?.user_name ?? p.login })
                    : t("{name} folgen", { name: p.info?.user_name ?? p.login })
              }
              onClick={onFollowClick}
            >
              <Icon name={follow.following && !confirmUnfollow ? "heart" : "heart-outline"} size={20} />
              {confirmUnfollow && <span className="follow-confirm">{t("Entfolgen?")}</span>}
            </button>
          )}
          <button className="pbtn" title={p.isFavorite ? t("Aus Favoriten entfernen") : t("Zu Favoriten")} onClick={p.onToggleFavorite}>
            <Icon name={p.isFavorite ? "star" : "star-outline"} size={20} />
          </button>
          {p.multi && !p.fullscreen && (
            <button className="pbtn" title={t("Groß anzeigen")} onClick={p.onFocus}>
              <Icon name="expand" size={18} />
            </button>
          )}
          <button className="pbtn" title={t("Chat dieses Kanals")} onClick={p.onChat}>
            <Icon name="chat" size={18} />
          </button>
          <button className="pbtn" title={t("Schließen")} onClick={p.onClose}>
            <Icon name="close-fill" size={20} />
          </button>
        </div>
      </div>

      <div className="tile-bottom" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button className="pbtn" onClick={togglePlay} title={paused ? t("Abspielen") : t("Pause")}>
          <Icon name={paused ? "play" : "pause"} size={24} />
        </button>
        <div className="volume">
          <button className="pbtn" onClick={toggleMute} title={effectiveMuted ? t("Ton an") : t("Stumm")}>
            <Icon name={effectiveMuted || volume === 0 ? "volume-off" : volume > 0.5 ? "volume-high" : "volume-low"} size={22} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={effectiveMuted ? 0 : volume}
            style={{ ["--vol" as any]: `${(effectiveMuted ? 0 : volume) * 100}%` }}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              setUserMuted(false);
              setAutoplayBlocked(false);
              if (!p.audible) p.onAudio();
              updateSettings({ volume: v });
            }}
          />
        </div>
        <button className="live-btn" onClick={goLive} title={t("Zur Live-Kante springen")}>
          <span className={status.kind === "playing" && !paused ? "live-dot" : "live-dot off"} /> LIVE
        </button>
        <div className="spacer" />
        <div className="quality">
          <button className={`pbtn ${menu ? "on" : ""}`} onClick={() => setMenu((m) => !m)} title={`${t("Qualität")}: ${t(currentLabel)}`}>
            <Icon name="settings" size={20} />
          </button>
          {menu && (
            <div className="quality-menu">
              <div className="quality-head">{t("Qualität")}</div>
              {levels.map((l) => (
                <button
                  key={l.index}
                  className={l.index === level ? "on" : ""}
                  onClick={() => {
                    playerRef.current?.setQuality(l.index);
                    setLevel(l.index);
                    setMenu(false);
                  }}
                >
                  {l.index === level ? <Icon name="check" size={14} /> : <span className="qspace" />}
                  {t(l.label)}
                </button>
              ))}
              <button
                onClick={() => {
                  setMenu(false);
                  setReload((r) => r + 1);
                }}
              >
                <Icon name="refresh" size={14} /> {t("Neu laden")}
              </button>
            </div>
          )}
        </div>
        <button className="pbtn" onClick={fullscreen} title={p.fullscreen ? t("Vollbild beenden (Esc)") : t("Vollbild (Doppelklick)")}>
          <Icon name={p.fullscreen ? "fullscreen-exit" : "fullscreen"} size={24} />
        </button>
      </div>
    </div>
  );
}
