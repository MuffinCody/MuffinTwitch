import { useEffect, useState, type MouseEvent } from "react";
import { boxArt, twitchApi, thumb, type HelixGame, type HelixStream } from "../lib/api";
import { toggleFavGame, updateSettings, useSettings } from "../lib/settings";
import { Icon } from "./Icon";
import { useT } from "../lib/i18n";

export type BrowseTarget = { kind: "categories" } | { kind: "game"; game: HelixGame };

interface Props {
  target: BrowseTarget;
  canAdd: boolean;
  onNavigate(t: BrowseTarget): void;
  onOpen(login: string, add: boolean): void;
  onClose(): void;
}

const LANGUAGES: [string, string][] = [
  ["", "Alle Sprachen"],
  ["de", "Deutsch"],
  ["en", "Englisch"],
  ["es", "Spanisch"],
  ["fr", "Französisch"],
];

function formatViewers(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);
}

/** Überlagert den Multiview (Streams laufen im Hintergrund weiter). */
export function BrowseView({ target, canAdd, onNavigate, onOpen, onClose }: Props) {
  const settings = useSettings();
  const t = useT();
  const [games, setGames] = useState<HelixGame[]>([]);
  const [streams, setStreams] = useState<HelixStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyFav, setOnlyFav] = useState(settings.categoryFilter === "fav");
  const isFav = (id: string) => settings.favGames.some((g) => g.id === id);

  const gameId = target.kind === "game" ? target.game.id : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = target.kind === "categories"
      ? twitchApi.topGames(60).then((g) => !cancelled && setGames(g))
      : twitchApi.streamsByGame(target.game.id, settings.browseLanguage, 40).then((s) => !cancelled && setStreams(s));
    load
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, gameId, settings.browseLanguage]);

  const open = (e: MouseEvent, login: string) => onOpen(login, e.ctrlKey || e.shiftKey);

  return (
    <div className="browse">
      <div className="browse-head">
        {target.kind === "game" && (
          <button className="link" onClick={() => onNavigate({ kind: "categories" })}>
            {t("‹ Kategorien")}
          </button>
        )}
        {target.kind === "game" && (
          <img className="browse-art" src={boxArt(target.game.box_art_url, 52, 72)} alt="" />
        )}
        <h2>{target.kind === "game" ? target.game.name : t("Kategorien")}</h2>
        {target.kind === "game" && (
          <button
            className={`fav-toggle inline ${isFav(target.game.id) ? "on" : ""}`}
            title={t("Lieblingskategorie")}
            onClick={() => toggleFavGame(target.game)}
          >
            {isFav(target.game.id) ? "★" : "☆"}
          </button>
        )}
        {target.kind === "categories" && (
          <div className="chip-group">
            <button className={!onlyFav ? "chip on" : "chip"} onClick={() => setOnlyFav(false)}>
              {t("Alle")}
            </button>
            <button className={onlyFav ? "chip on" : "chip"} onClick={() => setOnlyFav(true)}>
              {t("★ Favoriten")}
            </button>
          </div>
        )}
        <div className="spacer" />
        {target.kind === "game" && (
          <select
            value={settings.browseLanguage}
            onChange={(e) => updateSettings({ browseLanguage: e.target.value })}
          >
            {LANGUAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {t(l)}
              </option>
            ))}
          </select>
        )}
        <button className="icon-btn" title={t("Schließen")} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="browse-body">
        {loading && <div className="spinner center" />}
        {error && <div className="error">{error}</div>}

        {!loading && target.kind === "categories" && (
          <>
            {onlyFav && settings.favGames.length === 0 && (
              <div className="hint">{t("Noch keine Lieblingskategorien – markiere welche mit ☆.")}</div>
            )}
            <div className="game-grid">
              {(onlyFav ? settings.favGames : games).map((g) => {
                const fav = isFav(g.id);
                return (
                  <div key={g.id} className="game-card" onClick={() => onNavigate({ kind: "game", game: g })}>
                    <div className="game-art">
                      <img src={boxArt(g.box_art_url, 144, 192)} alt="" loading="lazy" />
                      <button
                        className={`fav-toggle ${fav ? "on" : ""}`}
                        title={fav ? t("Aus Lieblingskategorien entfernen") : t("Zu Lieblingskategorien")}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavGame(g);
                        }}
                      >
                        {fav ? "★" : "☆"}
                      </button>
                    </div>
                    <span>{g.name}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!loading && target.kind === "game" && (
          <>
            {streams.length === 0 && !error && <div className="hint">{t("Gerade keine Streams.")}</div>}
            <div className="stream-grid">
              {streams.map((s) => (
                <div key={s.id} className="stream-card" onClick={(e) => open(e, s.user_login)} title={t("Klick: öffnen · Strg+Klick: zum Multiview")}>
                  <div className="thumb">
                    <img src={thumb(s.thumbnail_url)} alt="" loading="lazy" />
                    <span className="live-pill">LIVE</span>
                    <span className="viewer-pill">{t("{n} Zuschauer", { n: formatViewers(s.viewer_count) })}</span>
                    <button
                      className="thumb-add"
                      disabled={!canAdd}
                      title={t("Zum Multiview hinzufügen")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(s.user_login, true);
                      }}
                    >
                      ＋
                    </button>
                  </div>
                  <div className="stream-card-title">{s.title}</div>
                  <div className="muted small">{s.user_name}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
