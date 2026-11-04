import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, helixApi, type AuthInfo, type HelixGame, type HelixStream, type HelixUser } from "./lib/api";
import { irc } from "./lib/irc";
import { joinChannel, leaveChannel, startChat } from "./lib/chat";
import { loadGlobalBadges, resetBadges } from "./lib/badges";
import { setSelfUser } from "./lib/seventv";
import { points } from "./lib/points";
import { getSettings, recordWatch, updateSettings, useSettings } from "./lib/settings";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useT } from "./lib/i18n";
import { actionForKey, isTyping, keyName, playerBus } from "./lib/shortcuts";
import { setFollowUser } from "./lib/follows";
import { MultiView, type Layout } from "./components/MultiView";
import { PlayerTile } from "./components/PlayerTile";
import { ChatPanel } from "./components/ChatPanel";
import { Sidebar } from "./components/Sidebar";
import { SettingsDialog, type SettingsTab } from "./components/SettingsDialog";
import { SearchBox } from "./components/SearchBox";
import { UserMenu } from "./components/UserMenu";
import { DropsButton } from "./components/DropsButton";
import { BrowseView, type BrowseTarget } from "./components/BrowseView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { resetTwitchEmotes } from "./components/EmotePicker";
import { Icon } from "./components/Icon";

const MAX_STREAMS = 9;

/** Akzeptiert "name", "twitch.tv/name" oder komplette URLs. */
function normalizeLogin(input: string): string | null {
  let s = input.trim().toLowerCase();
  const m = /twitch\.tv\/([a-z0-9_]+)/.exec(s);
  if (m) s = m[1];
  s = s.replace(/^[@#]/, "");
  return /^[a-z0-9_]{1,25}$/.test(s) ? s : null;
}

/** Twitch-„Glitch“-Logo */
function TwitchGlitch() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#9146FF"
        d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"
      />
    </svg>
  );
}

export default function App() {
  const settings = useSettings();
  const t = useT();
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [me, setMe] = useState<HelixUser | null>(null);
  const [channels, setChannels] = useState<string[]>(() =>
    getSettings().restoreChannels ? getSettings().lastChannels.slice(0, MAX_STREAMS) : [],
  );
  const [layout, setLayout] = useState<Layout>("grid");
  const [focused, setFocused] = useState<string | null>(null);
  const [audio, setAudio] = useState<string | null>(() => getSettings().lastChannels[0] ?? null);
  const [activeChat, setActiveChat] = useState<string | "*">(() => getSettings().lastChannels[0] ?? "*");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [multiMode, setMultiMode] = useState(false);
  /** Stream Together: Kanal → Partner */
  const [together, setTogether] = useState<Record<string, HelixUser[]>>({});
  /** Twitch-User-ID → Nutzer (für Herkunft im geteilten Chat) */
  const [roomUsers, setRoomUsers] = useState<Record<string, HelixUser>>({});
  const roomUsersRef = useRef<Record<string, HelixUser>>({});
  const [browse, setBrowse] = useState<BrowseTarget | null>(null);
  const [followed, setFollowed] = useState<HelixStream[]>([]);
  const [games, setGames] = useState<HelixGame[]>([]);
  const [streamInfo, setStreamInfo] = useState<Record<string, HelixStream>>({});
  const [avatars, setAvatars] = useState<Record<string, HelixUser>>({});
  const joined = useRef(new Set<string>());

  // ---------- Login ----------
  const loadAuth = useCallback(async () => {
    try {
      const a = await api.authGet();
      setAuth(a);
      irc.setCredentials(a.logged_in ? await api.chatCredentials() : null);
      resetBadges();
      resetTwitchEmotes();
      setSelfUser(a.logged_in ? a.user_id : null);
      if (a.logged_in) {
        loadGlobalBadges();
        if (a.user_id) helixApi.usersById([a.user_id]).then((u) => setMe(u[0] ?? null)).catch(() => {});
        helixApi.topGames(12).then(setGames).catch(() => {});
      } else {
        setMe(null);
        setFollowed([]);
        setGames([]);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadAuth().finally(() => startChat());
  }, [loadAuth]);

  // Login-Fenster meldet Erfolg
  useEffect(() => {
    const un = listen("auth-changed", () => {
      loadAuth();
      setShowSettings(false);
    });
    return () => {
      un.then((f) => f());
    };
  }, [loadAuth]);

  const login = () => api.authWebLogin().catch(() => setShowSettings(true));
  const logout = async () => {
    await api.authLogout("all");
    loadAuth();
  };

  // ---------- Fehler protokollieren ----------
  useEffect(() => {
    const onErr = (e: ErrorEvent) => api.logError(`window.onerror: ${e.message} @ ${e.filename}:${e.lineno}`).catch(() => {});
    const onRej = (e: PromiseRejectionEvent) => api.logError(`unhandledrejection: ${String(e.reason)}`).catch(() => {});
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  // ---------- Chat-Kanäle synchron halten ----------
  useEffect(() => {
    for (const c of channels)
      if (!joined.current.has(c)) {
        joined.current.add(c);
        joinChannel(c);
      }
    for (const c of [...joined.current])
      if (!channels.includes(c)) {
        joined.current.delete(c);
        leaveChannel(c);
      }
    updateSettings({ lastChannels: channels });
    if (activeChat !== "*" && !channels.includes(activeChat)) setActiveChat(channels[0] ?? "*");
    if (activeChat === "*" && channels.length === 1) setActiveChat(channels[0]);
    if (audio && !channels.includes(audio)) setAudio(channels[0] ?? null);
    if (focused && !channels.includes(focused)) setFocused(null);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Kanalpunkte ----------
  useEffect(() => {
    points.setChannels(channels, !!auth?.web);
  }, [channels.join(","), auth?.web]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Gefolgte Live-Kanäle (eigener Takt + Aktualisieren-Knopf) ----------
  const followedRef = useRef<HelixStream[]>([]);
  const [followLoading, setFollowLoading] = useState(false);
  const [followUpdated, setFollowUpdated] = useState<number | null>(null);
  const refreshFollowed = useCallback(async () => {
    if (!auth?.logged_in || !auth.user_id) return;
    setFollowLoading(true);
    try {
      const fol = await helixApi.followedStreams(auth.user_id);
      followedRef.current = fol;
      setFollowed(fol);
      setFollowUpdated(Date.now());
      const need = fol.map((f) => f.user_login).filter((l) => !avatarsRef.current[l]);
      if (need.length) {
        const users = await helixApi.usersByLogin(need);
        setAvatars((prev) => {
          const next = { ...prev };
          for (const u of users) next[u.login] = u;
          return next;
        });
      }
    } catch (e) {
      console.warn("Helix (gefolgt)", e);
    } finally {
      setFollowLoading(false);
    }
  }, [auth]);

  // Folgen-Knopf: nur mit twitch.tv-Login (Twitch-Webseiten-Token)
  useEffect(() => {
    setFollowUser(auth?.web && auth.user_id ? auth.user_id : null, refreshFollowed);
  }, [auth, refreshFollowed]);

  useEffect(() => {
    refreshFollowed();
    const t = window.setInterval(refreshFollowed, Math.max(1, settings.followRefreshMin) * 60_000);
    return () => window.clearInterval(t);
  }, [refreshFollowed, settings.followRefreshMin]);

  const avatarsRef = useRef(avatars);
  avatarsRef.current = avatars;

  // ---------- Stream-Infos der offenen Kanäle/Favoriten (Helix, nur mit Login) ----------
  const refreshInfo = useCallback(async () => {
    if (!auth?.logged_in || !auth.user_id) return;
    try {
      const s = getSettings();
      const logins = [...new Set([...channels, ...s.favorites])];
      const info = await helixApi.streamsByLogin(logins);
      const fol = followedRef.current;
      const map: Record<string, HelixStream> = {};
      for (const x of [...fol, ...info]) map[x.user_login] = x;
      setStreamInfo(map);

      const need = logins.filter((l) => !avatars[l]);
      if (need.length) {
        const users = await helixApi.usersByLogin(need);
        setAvatars((prev) => {
          const next = { ...prev };
          for (const u of users) next[u.login] = u;
          return next;
        });
      }

      // Stream Together / geteilter Chat für offene Live-Kanäle
      const live = channels.map((c) => map[c]).filter(Boolean) as HelixStream[];
      const sessions = await Promise.all(
        live.map((st) => helixApi.sharedChatParticipants(st.user_id).catch(() => null)),
      );
      const ids = new Set<string>();
      sessions.forEach((p) => p?.forEach((id) => ids.add(id)));
      const missing = [...ids].filter((id) => !roomUsersRef.current[id]);
      const users = missing.length ? await helixApi.usersById(missing).catch(() => [] as HelixUser[]) : [];
      const byId = { ...roomUsersRef.current };
      for (const u of users) byId[u.id] = u;
      roomUsersRef.current = byId;
      setRoomUsers(byId);
      const tog: Record<string, HelixUser[]> = {};
      live.forEach((st, i) => {
        const p = sessions[i];
        if (!p || p.length < 2) return;
        tog[st.user_login] = p.filter((id) => id !== st.user_id).map((id) => byId[id]).filter(Boolean);
      });
      setTogether(tog);
    } catch (e) {
      console.warn("Helix", e);
    }
  }, [auth, channels, avatars]);

  const refreshRef = useRef(refreshInfo);
  refreshRef.current = refreshInfo;
  useEffect(() => {
    refreshRef.current();
    const t = window.setInterval(() => refreshRef.current(), 60000);
    return () => window.clearInterval(t);
  }, [auth, channels.join(","), settings.favorites.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Vollbild (eigener Modus statt Browser-Vollbild → kein Ruckeln) ----------
  useEffect(() => {
    getCurrentWindow().setFullscreen(!!fullscreen).catch(() => {});
    if (!fullscreen) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [fullscreen]);

  useEffect(() => {
    if (fullscreen && !channels.includes(fullscreen)) setFullscreen(null);
  }, [channels, fullscreen]);

  // ---------- Zuschau-Statistik (für "Zuletzt gesehen" / "Empfohlen") ----------
  useEffect(() => {
    channels.forEach((c) => recordWatch(c));
    const t = window.setInterval(() => {
      if (document.hidden) return;
      for (const c of channels) recordWatch(c, 1);
    }, 60_000);
    return () => window.clearInterval(t);
  }, [channels.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSettings = (tab?: SettingsTab) => {
    setSettingsTab(tab);
    setShowSettings(true);
  };

  // ---------- Panels ein-/ausblenden ----------
  const toggleSidebar = () => updateSettings({ sidebarOpen: !getSettings().sidebarOpen });
  const toggleChat = () => updateSettings({ chatOpen: !getSettings().chatOpen });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (k === "j") {
        e.preventDefault();
        toggleChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- Player-Tastenkürzel (in den Einstellungen änderbar) ----------
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (e) => {
    if (!settings.shortcutsEnabled || showSettings || e.ctrlKey || e.altKey || e.metaKey) return;
    if (isTyping(e) || channels.length === 0) return;
    const action = actionForKey(keyName(e));
    if (!action) return;
    e.preventDefault();
    // Fokus auf einem Knopf würde z. B. bei der Leertaste zusätzlich klicken
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    const target =
      fullscreen ?? (audio && channels.includes(audio) ? audio : layout === "focus" && focused ? focused : channels[0]);
    switch (action) {
      case "fullscreen":
        setFullscreen((f) => (f ? null : target));
        setAudio(target);
        setActiveChat(target);
        break;
      case "chat":
        if (fullscreen) updateSettings({ fsChat: !settings.fsChat });
        else toggleChat();
        break;
      case "nextStream": {
        if (channels.length < 2) break;
        const next = channels[(channels.indexOf(target) + 1) % channels.length];
        setAudio(next);
        setActiveChat(next);
        if (fullscreen) setFullscreen(next);
        else if (layout === "focus") setFocused(next);
        break;
      }
      default:
        playerBus.emit(target, action);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- Aktionen ----------
  const openChannel = (raw: string, addRequested: boolean) => {
    const login = normalizeLogin(raw);
    if (!login) return;
    const add = addRequested || multiMode;
    setBrowse(null);
    setChannels((prev) => {
      if (!add) return [login];
      if (prev.includes(login)) return prev;
      return prev.length >= MAX_STREAMS ? prev : [...prev, login];
    });
    if (!add || channels.length === 0) {
      setAudio(login);
      setActiveChat(login);
    } else if (!channels.includes(login)) {
      setActiveChat("*");
    }
  };

  const closeChannel = (login: string) => setChannels((prev) => prev.filter((c) => c !== login));

  const toggleFavorite = (login: string) => {
    const fav = getSettings().favorites;
    updateSettings({ favorites: fav.includes(login) ? fav.filter((f) => f !== login) : [...fav, login] });
  };

  // ---------- Chat-Breite per Ziehen ----------
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = getSettings().chatWidth;
    const move = (ev: MouseEvent) =>
      updateSettings({ chatWidth: Math.max(240, Math.min(700, startW + (startX - ev.clientX))) });
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const multi = channels.length > 1;
  const canAdd = channels.length < MAX_STREAMS;
  const favInfo: Record<string, HelixStream | undefined> = {};
  for (const f of settings.favorites) favInfo[f] = streamInfo[f];

  const renderTile = (login: string, style: CSSProperties) => (
    <ErrorBoundary name={`tile:${login}`} compact style={{ position: "absolute", ...style }}>
      <PlayerTile
        login={login}
        style={style}
        multi={multi}
        audible={!settings.audioFocus || !multi || audio === login}
        focused={layout === "focus" && (focused ?? channels[0]) === login && multi}
        info={streamInfo[login]}
        isFavorite={settings.favorites.includes(login)}
        authKey={auth?.web ? `web:${auth.login}` : "anon"}
        together={together[login]}
        channelId={streamInfo[login]?.user_id ?? avatars[login]?.id}
        onOpenPartner={(l) => openChannel(l, true)}
        fullscreen={fullscreen === login}
        onFullscreen={() => {
          setFullscreen((f) => (f === login ? null : login));
          setAudio(login);
          setActiveChat(login);
        }}
        onAudio={() => setAudio(login)}
        onClose={() => closeChannel(login)}
        onFocus={() => {
          setFocused(login);
          setLayout("focus");
          setAudio(login);
        }}
        onChat={() => {
          setActiveChat(login);
          // Im Vollbild: Chat-Overlay ein-/ausblenden
          if (fullscreen === login) updateSettings({ fsChat: !settings.fsChat });
          else if (!settings.chatOpen) updateSettings({ chatOpen: true });
        }}
        onToggleFavorite={() => toggleFavorite(login)}
      />
    </ErrorBoundary>
  );

  const chatPanel = (onHide: () => void) => (
    <ChatPanel
      channels={channels}
      active={activeChat}
      onActive={setActiveChat}
      loggedIn={!!auth?.logged_in}
      userId={auth?.user_id ?? null}
      onLogin={login}
      onHide={onHide}
      channelAvatars={Object.fromEntries(channels.map((c) => [c, avatars[c]?.profile_image_url]))}
      onOpenSettings={() => openSettings("chat")}
      roomUsers={roomUsers}
      together={together}
      onOpenChannel={(l) => openChannel(l, false)}
    />
  );

  return (
    <div className={fullscreen ? "app fs" : "app"}>
      {!fullscreen && <header className="topbar">
        <button
          className="brand"
          title={settings.sidebarOpen ? t("Kanalliste ausblenden (Strg+B)") : t("Kanalliste einblenden (Strg+B)")}
          onClick={toggleSidebar}
        >
          <TwitchGlitch />
        </button>
        <SearchBox
          loggedIn={!!auth?.logged_in}
          canAdd={canAdd}
          multiMode={multiMode}
          onOpen={openChannel}
          onGame={(g) => setBrowse({ kind: "game", game: g })}
          normalize={normalizeLogin}
        />
        <button
          className={`multi-btn ${multiMode ? "on" : ""}`}
          title={
            multiMode
              ? t("Multiview-Modus an: Kanäle werden hinzugefügt statt ersetzt (klicken zum Ausschalten)")
              : t("Multiview-Modus: Kanäle hinzufügen statt ersetzen")
          }
          onClick={() => setMultiMode((m) => !m)}
        >
          <Icon name="multiview" size={16} />
          <span>Multiview</span>
          {channels.length > 0 && <span className="multi-count">{channels.length}/{MAX_STREAMS}</span>}
        </button>
        <div className="spacer" />
        {multi && (
          <div className="seg">
            <button className={layout === "grid" ? "on" : ""} onClick={() => setLayout("grid")} title={t("Raster")}>
              <Icon name="grid" size={14} />
            </button>
            <button
              className={layout === "focus" ? "on" : ""}
              onClick={() => {
                setLayout("focus");
                if (!focused) setFocused(audio ?? channels[0]);
              }}
              title={t("Fokus (ein großer Stream)")}
            >
              <Icon name="focus" size={14} />
            </button>
          </div>
        )}
        {auth?.web && <DropsButton />}
        <UserMenu auth={auth} me={me} onLogin={login} onLogout={logout} onSettings={() => openSettings()} />
      </header>}

      <div className="main">
        {settings.sidebarOpen && !fullscreen && (
          <ErrorBoundary name="sidebar">
            <Sidebar
              followed={followed}
              followLoading={followLoading}
              followUpdated={followUpdated}
              onRefreshFollowed={refreshFollowed}
              favorites={settings.favorites}
              favInfo={favInfo}
              avatars={avatars}
              loggedIn={!!auth?.logged_in}
              openChannels={channels}
              onOpen={openChannel}
              onRemoveFavorite={toggleFavorite}
              onHide={toggleSidebar}
              games={games}
              onGame={(g) => setBrowse({ kind: "game", game: g })}
              onAllCategories={() => setBrowse({ kind: "categories" })}
            />
          </ErrorBoundary>
        )}

        <div className="center">
          <MultiView
            channels={channels}
            layout={layout}
            focused={focused}
            fullscreen={fullscreen}
            renderTile={renderTile}
            empty={
              <div className="empty">
                <h1>{t("Willkommen bei MuffinTwitch")}</h1>
                <p>{t("Suche oben nach einem Kanal oder wähle links einen Favoriten bzw. eine Kategorie.")}</p>
                <p className="muted">
                  {t("Mit")} <b>＋</b> {t("oder")} <kbd>{t("Strg")}</kbd>{t("+Klick schaust du bis zu {n} Streams gleichzeitig.", { n: MAX_STREAMS })}
                </p>
              </div>
            }
          />
          {!fullscreen && !settings.sidebarOpen && (
            <button className="edge-handle left" title={t("Kanalliste einblenden (Strg+B)")} onClick={toggleSidebar}>
              <Icon name="panel-left" />
            </button>
          )}
          {!fullscreen && !settings.chatOpen && (
            <button className="edge-handle right" title={t("Chat einblenden (Strg+J)")} onClick={toggleChat}>
              <Icon name="panel-right" />
            </button>
          )}
          {browse && !fullscreen && (
            <ErrorBoundary name="browse">
              <BrowseView
                target={browse}
                canAdd={canAdd}
                onNavigate={setBrowse}
                onOpen={openChannel}
                onClose={() => setBrowse(null)}
              />
            </ErrorBoundary>
          )}
        </div>

        {settings.chatOpen && !fullscreen && (
          <>
            <div className="resizer" onMouseDown={startResize} />
            <ErrorBoundary name="chat">{chatPanel(toggleChat)}</ErrorBoundary>
          </>
        )}

        {/* Chat im Vollbild: halbtransparent über dem Video */}
        {fullscreen && settings.fsChat && (
          <div className="fs-chat">
            <ErrorBoundary name="fs-chat">{chatPanel(() => updateSettings({ fsChat: false }))}</ErrorBoundary>
          </div>
        )}
      </div>

      {showSettings && (
        <SettingsDialog auth={auth} initialTab={settingsTab} onClose={() => setShowSettings(false)} onAuthChanged={loadAuth} />
      )}
    </div>
  );
}
