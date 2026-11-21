import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "../lib/i18n";
import { Icon } from "./Icon";

interface SubStatus {
  can_subscribe: boolean;
  subscribed: boolean;
  tier: string | null;
  prime: boolean;
  gift: boolean;
  months: number;
  renews_at: string | null;
  ends_at: string | null;
}

const TIER: Record<string, string> = { "1000": "1", "2000": "2", "3000": "3" };

/**
 * Abo-Knopf unter dem Folgen-Knopf. Zeigt den Abo-Status; ein Klick öffnet die
 * Abo-Seite von Twitch im Browser (Bezahlung läuft ausschließlich bei Twitch).
 */
export function SubButton({ login, name }: { login: string; name: string }) {
  const t = useT();
  const [st, setSt] = useState<SubStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      invoke<SubStatus>("sub_status", { channel: login })
        .then((s) => !cancelled && setSt(s))
        .catch(() => {});
    load();
    // Nach dem Abonnieren im Browser: beim Zurückkehren in die App neu prüfen
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [login]);

  if (!st || !st.can_subscribe) return null;

  let title: string;
  if (st.subscribed) {
    const parts = [t("Stufe {n}", { n: st.tier ? (TIER[st.tier] ?? st.tier) : "?" })];
    if (st.prime) parts.push("Prime");
    if (st.gift) parts.push(t("Geschenkt"));
    if (st.months > 0) parts.push(t("{n} Monate", { n: st.months }));
    title = `${t("Du hast {name} abonniert", { name })} (${parts.join(" · ")}) – ${t("klicken, um das Abo bei Twitch zu verwalten")}`;
  } else {
    title = st.months > 0 ? t("{name} wieder abonnieren ({n} Monate bisher)", { name, n: st.months }) : t("{name} abonnieren", { name });
  }

  return (
    <button
      className={`pbtn sub-btn ${st.subscribed ? "subscribed" : ""}`}
      title={title}
      onClick={() => openUrl(`https://www.twitch.tv/subs/${login}`).catch(() => {})}
    >
      <Icon name="crown" size={19} />
    </button>
  );
}
