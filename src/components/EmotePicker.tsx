import { useEffect, useMemo, useRef, useState } from "react";
import { channelEmoteList, globalEmoteList, loadUserTwitchEmotes, onEmotesChanged, type Emote, type Provider } from "../lib/emotes";
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
    if (userId) loadUserTwitchEmotes().then(setTwitch);
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
    // 1. Zuletzt benutzt (Reihenfolge der Benutzung)
    if (recent.length) out.push({ title: t("Zuletzt benutzt"), emotes: recent });

    // Eigene Twitch-Emotes nach Kanal gruppieren, jeweils alphabetisch
    const tw = twitch.filter(match);
    const byOwner = new Map<string, { name: string; emotes: Emote[] }>();
    const twitchGlobal: Emote[] = [];
    for (const e of tw) {
      if (!e.ownerLogin || e.ownerLogin === "twitch") {
        twitchGlobal.push(e);
        continue;
      }
      const g = byOwner.get(e.ownerLogin) ?? { name: e.owner ?? e.ownerLogin, emotes: [] };
      g.emotes.push(e);
      byOwner.set(e.ownerLogin, g);
    }
    byOwner.forEach((g) => g.emotes.sort(byName));
    twitchGlobal.sort(byName);

    // 2. Dieser Kanal: deine Abo-Emotes, dann 7TV/BTTV/FFZ
    const own = byOwner.get(channel);
    if (own) out.push({ title: `${t("Kanal")} · ${own.name}`, emotes: own.emotes });
    for (const p of ["7tv", "bttv", "ffz"] as Provider[]) {
      const list = chan.filter((e) => e.provider === p);
      if (list.length) out.push({ title: `${t("Kanal")} · ${PROVIDER_LABEL[p]}`, emotes: list });
    }

    // 3. Deine Abo-Emotes anderer Kanäle, nach Kanalname sortiert
    [...byOwner.entries()]
      .filter(([login]) => login !== channel)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .forEach(([, g]) => out.push({ title: `${t("Abo")} · ${g.name}`, emotes: g.emotes }));

    // 4. Global: Twitch, dann 7TV/BTTV/FFZ
    if (twitchGlobal.length) out.push({ title: "Global · Twitch", emotes: twitchGlobal });
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
