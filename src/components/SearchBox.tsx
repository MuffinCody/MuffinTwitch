import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { boxArt, twitchApi, type HelixChannelSearch, type HelixGame } from "../lib/api";
import { Icon } from "./Icon";
import { useT } from "../lib/i18n";

interface Props {
  loggedIn: boolean;
  canAdd: boolean;
  /** Multiview-Modus aktiv → Enter fügt hinzu statt zu ersetzen */
  multiMode: boolean;
  onOpen(login: string, add: boolean): void;
  onGame(game: HelixGame): void;
  normalize(input: string): string | null;
}

type Item = { kind: "channel"; c: HelixChannelSearch } | { kind: "game"; g: HelixGame };

/** Suchfeld mit Live-Vorschlägen: Kanäle und Kategorien. */
export function SearchBox({ loggedIn, canAdd, multiMode, onOpen, onGame, normalize }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [channels, setChannels] = useState<HelixChannelSearch[]>([]);
  const [games, setGames] = useState<HelixGame[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!loggedIn || q.length < 2 || /twitch\.tv\//i.test(q)) {
      setChannels([]);
      setGames([]);
      return;
    }
    const id = ++reqId.current;
    const t = window.setTimeout(async () => {
      const { channels: c, games: g } = await twitchApi
        .search(q, 7, 4)
        .catch(() => ({ channels: [] as HelixChannelSearch[], games: [] as HelixGame[] }));
      if (id !== reqId.current) return;
      // Live-Kanäle zuerst
      setChannels([...c].sort((a, b) => Number(b.is_live) - Number(a.is_live)));
      setGames(g);
      setSel(-1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, loggedIn]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, []);

  const items: Item[] = [
    ...channels.map((c) => ({ kind: "channel" as const, c })),
    ...games.map((g) => ({ kind: "game" as const, g })),
  ];

  const reset = () => {
    setQuery("");
    setChannels([]);
    setGames([]);
    setOpen(false);
  };

  const chooseChannel = (login: string, add: boolean) => {
    onOpen(login, add || multiMode);
    reset();
  };

  const choose = (it: Item, add: boolean) => {
    if (it.kind === "channel") chooseChannel(it.c.broadcaster_login, add);
    else {
      onGame(it.g);
      reset();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(-1, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const add = e.ctrlKey || e.shiftKey;
      if (sel >= 0 && items[sel]) choose(items[sel], add);
      else {
        const login = normalize(query);
        if (login) chooseChannel(login, add);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const valid = !!normalize(query);

  return (
    <div className="search" ref={boxRef}>
      <div className="search-field">
        <Icon name="search" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={loggedIn ? t("Kanäle und Kategorien suchen…") : t("Kanalname oder twitch.tv-Link…")}
          spellCheck={false}
        />
        {valid && !multiMode && (
          <button
            className="search-add"
            disabled={!canAdd}
            title={t("Zum Multiview hinzufügen (Strg+Enter)")}
            onClick={() => {
              const l = normalize(query);
              if (l) chooseChannel(l, true);
            }}
          >
            ＋
          </button>
        )}
      </div>
      {open && items.length > 0 && (
        <div className="search-results">
          {channels.length > 0 && <div className="search-section">{t("Kanäle")}</div>}
          {channels.map((r, i) => (
            <div
              key={r.id}
              className={`search-item ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={(e) => chooseChannel(r.broadcaster_login, e.ctrlKey || e.shiftKey)}
            >
              <img className="avatar" src={r.thumbnail_url} alt="" />
              <div className="entry-text">
                <div className="entry-name">
                  {r.display_name}
                  {r.is_live && <span className="live-pill">LIVE</span>}
                </div>
                <div className="entry-game">{r.is_live ? `${r.game_name} · ${r.title}` : r.game_name || t("Offline")}</div>
              </div>
              {!multiMode && (
                <button
                  className="add"
                  title={t("Zum Multiview hinzufügen")}
                  disabled={!canAdd}
                  onClick={(e) => {
                    e.stopPropagation();
                    chooseChannel(r.broadcaster_login, true);
                  }}
                >
                  ＋
                </button>
              )}
            </div>
          ))}
          {games.length > 0 && <div className="search-section">{t("Kategorien")}</div>}
          {games.map((g, j) => {
            const i = channels.length + j;
            return (
              <div
                key={g.id}
                className={`search-item ${i === sel ? "sel" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose({ kind: "game", g }, false)}
              >
                <img className="box-art search-art" src={boxArt(g.box_art_url, 30, 40)} alt="" />
                <div className="entry-text">
                  <div className="entry-name">{g.name}</div>
                  <div className="entry-game">{t("Kategorie")}</div>
                </div>
              </div>
            );
          })}
          <div className="search-hint">
            {multiMode ? t("Multiview-Modus: Kanäle werden hinzugefügt") : t("Enter: öffnen · Strg+Enter / ＋: zum Multiview")}
          </div>
        </div>
      )}
    </div>
  );
}
