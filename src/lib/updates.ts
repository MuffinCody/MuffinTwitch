// Updates: Prüfen, herunterladen und installieren über den signierten Tauri-Updater.
// Installiert wird nur, wenn die Signatur zum in der App eingebauten öffentlichen
// Schlüssel passt. Linux-Pakete (deb/rpm/Arch) aktualisiert der Paketmanager –
// dort zeigt die App nur an, dass es eine neue Version gibt.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none"; current: string }
  | { kind: "available"; version: string; notes: string; canInstall: boolean }
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "installing"; version: string }
  | { kind: "error"; message: string };

let state: UpdateState = { kind: "idle" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(s: UpdateState) {
  state = s;
  listeners.forEach((l) => l());
}

export function useUpdate(): UpdateState {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}

/** "0.4.10" > "0.4.9" */
function newer(a: string, b: string) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** Nur anzeigen (ohne Installation): neueste Version aus latest.json des Releases. */
async function checkInfoOnly(current: string) {
  const latest = await invoke<{ version: string; notes?: string | null }>("latest_release");
  if (newer(latest.version, current)) set({ kind: "available", version: latest.version, notes: latest.notes ?? "", canInstall: false });
  else set({ kind: "none", current });
}

/** Nach Updates suchen. `silent`: Fehler nicht anzeigen (automatische Prüfung beim Start). */
export async function checkForUpdates(silent = false) {
  if (state.kind === "checking" || state.kind === "downloading" || state.kind === "installing") return;
  set({ kind: "checking" });
  try {
    const current = await getVersion();
    const kind = await invoke<string>("install_kind");
    if (kind === "linux-package") {
      await checkInfoOnly(current);
      return;
    }
    try {
      pending = await check();
    } catch (e) {
      // z. B. AppImage, wenn das Release (noch) kein signiertes Linux-Update enthält
      if (kind === "appimage") {
        await checkInfoOnly(current);
        return;
      }
      throw e;
    }
    if (pending) set({ kind: "available", version: pending.version, notes: pending.body ?? "", canInstall: true });
    else set({ kind: "none", current });
  } catch (e) {
    set(silent ? { kind: "idle" } : { kind: "error", message: String(e) });
  }
}

/** Update herunterladen, Signatur prüfen (macht der Updater), installieren und neu starten. */
export async function installUpdate() {
  const u = pending;
  if (!u) return;
  let total = 0;
  let done = 0;
  set({ kind: "downloading", version: u.version, percent: null });
  try {
    await u.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        done += ev.data.chunkLength;
        set({ kind: "downloading", version: u.version, percent: total ? Math.min(100, Math.round((done / total) * 100)) : null });
      } else if (ev.event === "Finished") set({ kind: "installing", version: u.version });
    });
    await relaunch();
  } catch (e) {
    set({ kind: "error", message: String(e) });
  }
}
