import { useEffect, useRef, useState } from "react";
import type { AuthInfo, HelixUser } from "../lib/api";
import { Icon } from "./Icon";
import { useT } from "../lib/i18n";

interface Props {
  auth: AuthInfo | null;
  me: HelixUser | null;
  onLogin(): void;
  onLogout(): void;
  onSettings(): void;
}

/** Oben rechts: Anmelden-Button bzw. Profilbild + Name mit Menü (wie bei Twitch). */
export function UserMenu({ auth, me, onLogin, onLogout, onSettings }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, []);

  if (!auth?.logged_in) {
    return (
      <div className="user-area">
        <button className="icon-btn" title={t("Einstellungen")} onClick={onSettings}>
          <Icon name="settings" />
        </button>
        <button className="login-btn" onClick={onLogin}>
          <Icon name="user" /> {t("Anmelden")}
        </button>
      </div>
    );
  }

  const name = me?.display_name ?? auth.login ?? "";
  return (
    <div className="user-area" ref={ref}>
      <button className={`user-chip ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)}>
        {me?.profile_image_url ? (
          <img src={me.profile_image_url} alt="" />
        ) : (
          <span className="avatar ph small">{name[0]?.toUpperCase()}</span>
        )}
        <span className="user-name">{name}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="user-menu">
          <div className="user-menu-head">
            {me?.profile_image_url && <img src={me.profile_image_url} alt="" />}
            <div>
              <b>{name}</b>
              <div className="muted small">{t("Turbo/Abo-Vorteile aktiv")}</div>
            </div>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            <Icon name="settings" /> {t("Einstellungen")}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <Icon name="logout" /> {t("Abmelden")}
          </button>
        </div>
      )}
    </div>
  );
}
