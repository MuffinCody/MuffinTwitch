import { useEffect, useMemo, useRef, useState } from "react";
import { channelEmoteList, globalEmoteList, onEmotesChanged, twitchEmote, type Emote, type Provider } from "../lib/emotes";
import { twitchApi } from "../lib/api";
import { useT } from "../lib/i18n";

const RECENT_KEY = "nativ.recentEmotes";
const PROVIDER_LABEL: Record<Provider, string> = { "7tv": "7TV", bttv: "BTTV", ffz: "FFZ", twitch: "Twitch" };

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function rememberEmote(name: string) {
  try {
    const list = [name, ...loadRecent().filter((n) => n !== name)].slice(0, 30);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// Eigene Twitch-Emotes (Subs etc.) – einmal pro Sitzung laden
let twitchEmotesCache: Promise<Emote[]> | null = null;
function loadTwitchEmotes(userId: string): Promise<Emote[]> {
  twitchEmotesCache ??= twitchApi
    .userEmotes(userId)
    .then((list) => list.map((e) => ({ ...twitchEmote(e.id, e.name), id: e.id })))
    .catch(() => {
    twitchEmotesCache = null;
    return [];
  });
  return twitchEmotesCache;
}

export function resetTwitchEmotes() {
  twitchEmotesCache = null;
}

interface Props {
  channel: string;
  userId: string | null;
  onPick(name: string): void;
  onClose(): void;
}

export function EmotePicker({ channel, userId, onPick, onClose }: Props) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState(0);
  const [twitch, setTwitch] = useState<Emote[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => onEmotesChanged(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    if (userId) loadTwitchEmotes(userId).then(setTwitch);
  }, [userId]);

  // Klick außerhalb / Escape schließt
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest(".emote-btn")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (e: Emote) => !q || e.name.toLowerCase().includes(q);
    const byName = (a: Emote, b: Emote) => a.name.localeCompare(b.name);
    const chan = channelEmoteList(channel).filter(match).sort(byName);
    const glob = globalEmoteList().filter(match).sort(byName);
    const all = new Map<string, Emote>();
    for (const e of [...glob, ...twitch, ...chan]) all.set(e.name, e);
    const recent = loadRecent()
      .map((n) => all.get(n))
      .filter((e): e is Emote => !!e && match(e));

    const out: { title: string; emotes: Emote[] }[] = [];
    if (recent.length) out.push({ title: t("Zuletzt benutzt"), emotes: recent });
    for (const p of ["7tv", "bttv", "ffz"] as Provider[]) {
      const list = chan.filter((e) => e.provider === p);
      if (list.length) out.push({ title: `${t("Kanal")} · ${PROVIDER_LABEL[p]}`, emotes: list });
    }
    const tw = twitch.filter(match);
    if (tw.length) out.push({ title: t("Twitch (deine Emotes)"), emotes: tw });
    for (const p of ["7tv", "bttv", "ffz"] as Provider[]) {
      const list = glob.filter((e) => e.provider === p);
      if (list.length) out.push({ title: `Global · ${PROVIDER_LABEL[p]}`, emotes: list });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, search, version, twitch, t("Kanal")]);

  return (
    <div className="emote-picker" ref={ref}>
      <input
        autoFocus
        className="emote-search"
        placeholder={t("Emotes suchen…")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="emote-sections">
        {sections.length === 0 && <div className="hint">{t("Keine Emotes gefunden.")}</div>}
        {sections.map((s) => (
          <div key={s.title}>
            <div className="emote-section-title">{s.title}</div>
            <div className="emote-grid">
              {s.emotes.map((e) => (
                <button
                  key={`${e.provider}-${e.id}`}
                  title={`${e.name} (${PROVIDER_LABEL[e.provider]})`}
                  onClick={(ev) => {
                    rememberEmote(e.name);
                    onPick(e.name);
                    if (!ev.shiftKey) onClose();
                  }}
                >
                  <img src={e.url} srcSet={e.srcset} alt={e.name} loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="emote-foot">{t("Shift+Klick: mehrere Emotes einfügen")}</div>
    </div>
  );
}
