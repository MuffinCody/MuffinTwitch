import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPlayer, type PlayerHandle, type PlayerStatus, type QualityOption } from "../lib/player";
import type { HelixStream, HelixUser } from "../lib/api";
import { useSettings, updateSettings } from "../lib/settings";
import { Icon } from "./Icon";

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

  // Lautstärke / Audio-Fokus
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = userMuted || !p.audible;
  }, [volume, userMuted, p.audible]);

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

  const effectiveMuted = userMuted || !p.audible;

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

  const toggleMute = () => {
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
        onClick={onVideoClick}
      />

      {status.kind !== "playing" && (
        <div className="tile-status">
          {status.kind === "loading" && <div className="spinner" />}
          {status.kind === "offline" && (
            <>
              <b>{p.login}</b> ist offline
              <small>Wird jede Minute erneut geprüft</small>
            </>
          )}
          {status.kind === "error" && (
            <>
              Fehler beim Laden
              <small>{status.message}</small>
              <button onClick={() => setReload((r) => r + 1)}>Erneut versuchen</button>
            </>
          )}
        </div>
      )}

      {p.together && p.together.length > 0 && (
        <div className="together-badge" title={`Streamt gemeinsam mit ${p.together.map((u) => u.display_name).join(", ")}`}>
          {p.together.slice(0, 4).map((u) => (
            <img key={u.id} src={u.profile_image_url} alt="" />
          ))}
          <span>Gemeinsam</span>
        </div>
      )}

      <div className="tile-top">
        <div className="tile-title">
          <b>{p.info?.user_name ?? p.login}</b>
          {p.info && (
            <span className="meta">
              {p.info.game_name} · {p.info.viewer_count.toLocaleString("de-DE")} Zuschauer · {uptime(p.info.started_at)}
            </span>
          )}
          {p.info?.title && <div className="stream-title">{p.info.title}</div>}
          {p.together && p.together.length > 0 && (
            <div className="together" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <span className="together-label">Gemeinsam mit</span>
              {p.together.map((u) => (
                <button
                  key={u.id}
                  className="together-chip"
                  title={`${u.display_name} zum Multiview hinzufügen`}
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
          <button className="pbtn" title={p.isFavorite ? "Aus Favoriten entfernen" : "Zu Favoriten"} onClick={p.onToggleFavorite}>
            <Icon name={p.isFavorite ? "star" : "star-outline"} size={20} />
          </button>
          {p.multi && !p.fullscreen && (
            <button className="pbtn" title="Groß anzeigen" onClick={p.onFocus}>
              <Icon name="expand" size={18} />
            </button>
          )}
          <button className="pbtn" title="Chat dieses Kanals" onClick={p.onChat}>
            <Icon name="chat" size={18} />
          </button>
          <button className="pbtn" title="Schließen" onClick={p.onClose}>
            <Icon name="close-fill" size={20} />
          </button>
        </div>
      </div>

      <div className="tile-bottom" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button className="pbtn" onClick={togglePlay} title={paused ? "Abspielen" : "Pause"}>
          <Icon name={paused ? "play" : "pause"} size={24} />
        </button>
        <div className="volume">
          <button className="pbtn" onClick={toggleMute} title={effectiveMuted ? "Ton an" : "Stumm"}>
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
              if (!p.audible) p.onAudio();
              updateSettings({ volume: v });
            }}
          />
        </div>
        <button className="live-btn" onClick={goLive} title="Zur Live-Kante springen">
          <span className={status.kind === "playing" && !paused ? "live-dot" : "live-dot off"} /> LIVE
        </button>
        <div className="spacer" />
        <div className="quality">
          <button className={`pbtn ${menu ? "on" : ""}`} onClick={() => setMenu((m) => !m)} title={`Qualität: ${currentLabel}`}>
            <Icon name="settings" size={20} />
          </button>
          {menu && (
            <div className="quality-menu">
              <div className="quality-head">Qualität</div>
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
                  {l.label}
                </button>
              ))}
              <button
                onClick={() => {
                  setMenu(false);
                  setReload((r) => r + 1);
                }}
              >
                <Icon name="refresh" size={14} /> Neu laden
              </button>
            </div>
          )}
        </div>
        <button className="pbtn" onClick={fullscreen} title={p.fullscreen ? "Vollbild beenden (Esc)" : "Vollbild (Doppelklick)"}>
          <Icon name={p.fullscreen ? "fullscreen-exit" : "fullscreen"} size={24} />
        </button>
      </div>
    </div>
  );
}
