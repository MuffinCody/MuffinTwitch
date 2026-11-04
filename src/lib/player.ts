import Hls, { type HlsConfig, type Level } from "hls.js";
import { api, proxify } from "./api";

/** hls.js-Loader, der jede Anfrage über den Rust-Proxy schickt. */
const BaseLoader = Hls.DefaultConfig.loader as any;
class ProxyLoader extends BaseLoader {
  load(context: any, config: any, callbacks: any) {
    context.url = proxify(context.url);
    super.load(context, config, callbacks);
  }
}

export interface QualityOption {
  index: number; // -1 = auto
  label: string;
}

export function qualityLabel(l: Level): string {
  const group = (l.attrs as any)?.VIDEO as string | undefined;
  if (group === "audio_only" || !l.height) return "Nur Audio";
  const fps = l.frameRate ? Math.round(l.frameRate) : 0;
  let label = `${l.height}p${fps > 31 ? fps : ""}`;
  if (group === "chunked") label += " (Source)";
  return label;
}

export type PlayerStatus =
  | { kind: "loading" }
  | { kind: "playing" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export interface PlayerHandle {
  destroy(): void;
  setQuality(index: number): void;
  levels(): QualityOption[];
  currentLevel(): number;
}

interface Options {
  lowLatency: boolean;
  preferSource: boolean;
  onStatus(s: PlayerStatus): void;
  onLevels(levels: QualityOption[], current: number): void;
  /** Browser hat Ton beim Autostart verboten → Video läuft stumm */
  onAutoplayMuted?(): void;
}

export async function createPlayer(
  video: HTMLVideoElement,
  login: string,
  opts: Options,
): Promise<PlayerHandle> {
  opts.onStatus({ kind: "loading" });
  const masterUrl = await api.getStreamUrl(login);

  const config: Partial<HlsConfig> = {
    loader: ProxyLoader as any,
    enableWorker: true,
    lowLatencyMode: false,
    // Kleine Puffer → deutlich weniger RAM pro Stream (wichtig im Multiview)
    backBufferLength: 8,
    maxBufferLength: 12,
    maxMaxBufferLength: 20,
    maxBufferSize: 30 * 1000 * 1000,
    liveSyncDurationCount: opts.lowLatency ? 2 : 3,
    liveMaxLatencyDurationCount: opts.lowLatency ? 5 : 10,
    maxLiveSyncPlaybackRate: opts.lowLatency ? 1.3 : 1,
    capLevelToPlayerSize: !opts.preferSource,
    startLevel: -1,
    manifestLoadingMaxRetry: 1,
    levelLoadingMaxRetry: 4,
    fragLoadingMaxRetry: 6,
  };

  const hls = new Hls(config);
  let destroyed = false;
  let mediaRecoveries = 0;

  const levels = (): QualityOption[] => [
    { index: -1, label: "Auto" },
    ...hls.levels
      .map((l, i) => ({ index: i, label: qualityLabel(l), h: l.height || 0, br: l.bitrate }))
      .sort((a, b) => b.h - a.h || b.br - a.br)
      .map(({ index, label }) => ({ index, label })),
  ];

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (opts.preferSource && hls.levels.length) {
      let best = 0;
      hls.levels.forEach((l, i) => {
        if ((l.height || 0) > (hls.levels[best].height || 0)) best = i;
      });
      hls.currentLevel = best;
    }
    opts.onLevels(levels(), hls.manualLevel);
    startPlayback(0);
  });

  /**
   * Abspielen starten. Wichtig: Nur stummschalten, wenn der Browser Ton wirklich verbietet
   * (NotAllowedError). Ein beim Start oft vorkommender "AbortError" (Laden unterbrochen)
   * führte früher fälschlich zu dauerhaft stummem Video, während die Anzeige "Ton an" zeigte.
   */
  const startPlayback = (attempt: number) => {
    if (destroyed) return;
    video.play().catch((e: DOMException) => {
      if (destroyed) return;
      if (e?.name === "NotAllowedError") {
        video.muted = true;
        opts.onAutoplayMuted?.();
        video.play().catch(() => {});
      } else if (attempt < 4) {
        window.setTimeout(() => startPlayback(attempt + 1), 400 * (attempt + 1));
      }
    });
  };

  hls.on(Hls.Events.LEVEL_SWITCHED, () => opts.onLevels(levels(), hls.manualLevel));
  hls.on(Hls.Events.FRAG_BUFFERED, () => opts.onStatus({ kind: "playing" }));

  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal || destroyed) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 3) {
      mediaRecoveries++;
      hls.recoverMediaError();
      return;
    }
    const code = (data.response as any)?.code;
    if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR && (code === 404 || code === 403)) {
      opts.onStatus({ kind: "offline" });
    } else if (data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR && code === 404) {
      // Stream wurde beendet
      opts.onStatus({ kind: "offline" });
    } else {
      opts.onStatus({ kind: "error", message: `${data.type}: ${data.details}` });
    }
  });

  hls.loadSource(proxify(masterUrl));
  hls.attachMedia(video);

  return {
    destroy() {
      destroyed = true;
      hls.destroy();
      video.removeAttribute("src");
      video.load();
    },
    setQuality(index: number) {
      hls.currentLevel = index;
      opts.onLevels(levels(), index);
    },
    levels,
    currentLevel: () => hls.manualLevel,
  };
}

export const hlsSupported = () => Hls.isSupported();
