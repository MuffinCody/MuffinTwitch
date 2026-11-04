import type { MouseEvent } from "react";
import { boxArt, type HelixGame, type HelixStream, type HelixUser } from "../lib/api";
import { updateSettings, useSettings, type Settings } from "../lib/settings";
import { Icon } from "./Icon";
import { t, locale } from "../lib/i18n";

interface Props {
  followed: HelixStream[];
  followLoading: boolean;
  followUpdated: number | null;
  onRefreshFollowed(): void;
  favorites: string[];
  favInfo: Record<string, HelixStream | undefined>;
  avatars: Record<string, HelixUser | undefined>;
  loggedIn: boolean;
  openChannels: string[];
  onOpen(login: string, add: boolean): void;
  onRemoveFavorite(login: string): void;
  onHide(): void;
  games: HelixGame[];
  onGame(g: HelixGame): void;
  onAllCategories(): void;
}

function Entry({
  login, name, stream, avatar, isOpen, onOpen, onRemove,
}: {
  login: string;
  name: string;
  stream?: HelixStream;
  avatar?: string;
  isOpen: boolean;
  onOpen(login: string, add: boolean): void;
  onRemove?: () => void;
}) {
  const click = (e: MouseEvent) => onOpen(login, e.ctrlKey || e.shiftKey);
  return (
    <div
      className={`entry ${stream ? "" : "offline"} ${isOpen ? "open" : ""}`}
      onClick={click}
      title={stream ? `${stream.title}\n\n${t("Klick: öffnen · Strg+Klick: zum Multiview hinzufügen")}` : t("Klick: öffnen · Strg+Klick: hinzufügen")}
    >
      {avatar ? <img className="avatar" src={avatar} alt="" /> : <div className="avatar ph">{name[0]?.toUpperCase()}</div>}
      <div className="entry-text">
        <div className="entry-name">{name}</div>
        <div className="entry-game">{stream ? stream.game_name || t("Live") : t("Offline")}</div>
      </div>
      {stream && <div className="viewers">{formatViewers(stream.viewer_count)}</div>}
      <button
        className="add"
        title={t("Zum Multiview hinzufügen")}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(login, true);
        }}
      >
        +
      </button>
      {onRemove && (
        <button
          className="add"
          title={t("Favorit entfernen")}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function formatViewers(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);
}

const SORT_LABELS: Record<Settings["followSort"], string> = {
  viewers: "Zuschauer",
  recent: "Zuletzt gesehen",
  recommended: "Empfohlen", // Übersetzung beim Anzeigen
};

/**
 * "Empfohlen": Kanäle, die du oft und kürzlich schaust, zuerst –
 * danach nach Zuschauerzahl (lokal berechnet, ohne Twitch-Algorithmus).
 */
function sortFollowed(list: HelixStream[], s: Settings): HelixStream[] {
  const stats = s.watchStats;
  const now = Date.now();
  const score = (x: HelixStream) => {
    const st = stats[x.user_login];
    if (!st) return 0;
    const days = (now - st.last) / 86_400_000;
    return Math.log2(1 + st.minutes) * Math.exp(-days / 14) + (s.favorites.includes(x.user_login) ? 2 : 0);
  };
  const out = [...list];
  switch (s.followSort) {
    case "recent":
      return out.sort(
        (a, b) => (stats[b.user_login]?.last ?? 0) - (stats[a.user_login]?.last ?? 0) || b.viewer_count - a.viewer_count,
      );
    case "recommended":
      return out.sort((a, b) => score(b) - score(a) || b.viewer_count - a.viewer_count);
    default:
      return out.sort((a, b) => b.viewer_count - a.viewer_count);
  }
}

export function Sidebar(p: Props) {
  const s = useSettings();
  const favSorted = [...p.favorites].sort((a, b) => {
    const la = p.favInfo[a] ? 1 : 0;
    const lb = p.favInfo[b] ? 1 : 0;
    return lb - la || (p.favInfo[b]?.viewer_count ?? 0) - (p.favInfo[a]?.viewer_count ?? 0) || a.localeCompare(b);
  });
  const followed = sortFollowed(p.followed, s);
  const showFavGames = s.categoryFilter === "fav";
  const gameList: HelixGame[] = showFavGames ? s.favGames : p.games;

  return (
    <nav className="sidebar">
      <div className="panel-head">
        <div className="section-title">{t("Favoriten")}</div>
        <button className="collapse pinned" title={t("Kanalliste ausblenden (Strg+B)")} onClick={p.onHide}>
          <Icon name="panel-left" />
        </button>
      </div>
      {favSorted.length === 0 && <div className="hint">{t("Mit ☆ im Player einen Kanal merken.")}</div>}
      {favSorted.map((l) => (
        <Entry
          key={l}
          login={l}
          name={p.favInfo[l]?.user_name ?? p.avatars[l]?.display_name ?? l}
          stream={p.favInfo[l]}
          avatar={p.avatars[l]?.profile_image_url}
          isOpen={p.openChannels.includes(l)}
          onOpen={p.onOpen}
          onRemove={() => p.onRemoveFavorite(l)}
        />
      ))}

      <div className="panel-head">
        <div className="section-title">{t("Gefolgt · Live")}</div>
        {p.loggedIn && (
          <button
            className={`refresh-btn ${p.followLoading ? "spinning" : ""}`}
            title={`${t("Jetzt aktualisieren")}${p.followUpdated ? ` (${t("zuletzt {time}", { time: new Date(p.followUpdated).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })})` : ""}`}
            disabled={p.followLoading}
            onClick={p.onRefreshFollowed}
          >
            <Icon name="refresh" size={14} />
          </button>
        )}
        <div className="spacer" />
        {p.loggedIn && (
          <select
            className="mini-select"
            value={s.followSort}
            title={t("Sortierung")}
            onChange={(e) => updateSettings({ followSort: e.target.value as Settings["followSort"] })}
          >
            {Object.entries(SORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        )}
      </div>
      {!p.loggedIn && <div className="hint">{t("Anmelden, um gefolgte Kanäle zu sehen.")}</div>}
      {p.loggedIn && followed.length === 0 && <div className="hint">{t("Niemand live.")}</div>}
      {followed.map((st) => (
        <Entry
          key={st.user_login}
          login={st.user_login}
          name={st.user_name}
          stream={st}
          avatar={p.avatars[st.user_login]?.profile_image_url}
          isOpen={p.openChannels.includes(st.user_login)}
          onOpen={p.onOpen}
        />
      ))}

      {p.loggedIn && (
        <>
          <div className="panel-head">
            <div className="section-title">{t("Kategorien")}</div>
            <div className="chip-group">
              <button
                className={!showFavGames ? "chip on" : "chip"}
                onClick={() => updateSettings({ categoryFilter: "top" })}
              >
                {t("Top")}
              </button>
              <button
                className={showFavGames ? "chip on" : "chip"}
                onClick={() => updateSettings({ categoryFilter: "fav" })}
                title={t("Lieblingskategorien")}
              >
                ★
              </button>
              <button className="chip" onClick={p.onAllCategories} title={t("Alle Kategorien")}>
                {t("Alle")}
              </button>
            </div>
          </div>
          {showFavGames && gameList.length === 0 && (
            <div className="hint">{t("Unter „Alle“ mit ☆ Lieblingskategorien markieren.")}</div>
          )}
          {gameList.map((g) => (
            <div key={g.id} className="entry game-entry" onClick={() => p.onGame(g)} title={g.name}>
              <img className="box-art" src={boxArt(g.box_art_url, 26, 36)} alt="" />
              <div className="entry-text">
                <div className="entry-name">{g.name}</div>
              </div>
              {s.favGames.some((f) => f.id === g.id) && !showFavGames && <span className="fav-star">★</span>}
            </div>
          ))}
        </>
      )}
    </nav>
  );
}
