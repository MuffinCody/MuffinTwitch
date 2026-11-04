# MuffinTwitch

Ein schlanker, nativer Twitch-Client für Windows – mit **Multiview**, **Chat inkl. 7TV/BTTV/FFZ** und vielen Komfortfunktionen.
Gebaut mit [Tauri 2](https://tauri.app) (Rust) und React. Die App ist nur ~8 MB groß und nutzt das in Windows 11 eingebaute WebView2.

> Inoffizielles Fanprojekt – steht in keiner Verbindung zu Twitch Interactive, Inc.

## Download

Den Installer gibt es unter **[Releases](../../releases/latest)**: `MuffinTwitch_x.y.z_x64-setup.exe` herunterladen und ausführen.
Windows SmartScreen warnt eventuell, weil die Datei nicht signiert ist („Weitere Informationen“ → „Trotzdem ausführen“).

## Funktionen

**Video**
- HLS-Player mit Qualitätsauswahl, niedriger Latenz und YouTube-artigen, minimalistischen Steuerelementen
- Eigener Vollbildmodus (Doppelklick / Esc)
- Mit twitch.tv-Login gelten **Turbo- und Abo-Vorteile** (keine Werbung)

**Multiview**
- Bis zu 9 Streams gleichzeitig, Raster- oder Fokus-Layout
- Audio-Fokus per Klick auf eine Kachel, Multiview-Modus-Schalter neben der Suche
- „Stream Together“: zeigt gemeinsame Streams (geteilter Chat) an

**Chat**
- Mehrere Kanäle als Tabs + gemischter Tab „Alle“ (mit Streamer-Profilbildern)
- Emotes von **7TV** (inkl. Zero-Width, Live-Updates, Namensfarben/Paints und Badges), **BTTV** und **FFZ**
- Emote-Auswahl, Tab-Vervollständigung, Erwähnungen mit Ton, Highlight-Wörter
- Chat verlangsamen/verzögern, Schriftart/-größe, Zeitstempel u. v. m.
- Chatverlauf beim Öffnen, Nutzerkarte mit älteren Nachrichten, Flüstern und Erwähnen

**Sonstiges**
- Suche nach Kanälen und Kategorien, Kategorie-Übersicht mit Lieblingskategorien
- Gefolgte Live-Kanäle, sortierbar nach Zuschauern, zuletzt gesehen oder „Empfohlen“
- Kanalpunkte (Kontostand, Belohnungen) und Drops-Fortschritt
- Favoriten, zuletzt geöffnete Kanäle, Tastenkürzel (**Strg+B** Kanalliste, **Strg+J** Chat)

## Login

Oben rechts auf **Anmelden** klicken – die normale twitch.tv-Loginseite öffnet sich in einem eigenen Fenster.
Danach übernimmt die App die Sitzung (für Chat, gefolgte Kanäle, Turbo/Abo, Kanalpunkte, Drops).

Das Token wird **nur lokal** gespeichert: `%APPDATA%\dev.nativ.twitchclient\auth.json`. „Abmelden“ löscht es und widerruft es bei Twitch.

**Hinweis zu Kanalpunkten & Drops:** Twitch erlaubt das Einsammeln von Bonus-Truhen, Belohnungen und Drops nur über die eigene Webseite („integrity check“).
„Einsammeln“ öffnet deshalb die passende Twitch-Seite in deinem Browser.

### Alternative: eigene Twitch-App (Einstellungen → Konto → Erweitert)

1. Auf <https://dev.twitch.tv/console/apps/create> eine App anlegen (OAuth-Redirect `http://localhost`, Client-Typ **Öffentlich**)
2. Client-ID in MuffinTwitch eintragen → **Verbinden** → Code im Browser bestätigen

## Selbst bauen

Voraussetzungen: [Node.js](https://nodejs.org) (LTS), [Rust](https://rustup.rs) (MSVC), WebView2 (bei Windows 11 vorinstalliert).

```bash
npm install
npm run app        # Entwicklungsmodus mit Hot-Reload
npm run app:build  # Release-Build (.exe + Installer)
```

Ergebnis:
- `src-tauri/target/release/MuffinTwitch.exe`
- `src-tauri/target/release/bundle/nsis/MuffinTwitch_<version>_x64-setup.exe`

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src-tauri/src/stream.rs` | Playback-Token holen, HLS-Playlist-URL bauen |
| `src-tauri/src/proxy.rs` | `twproxy://` – leitet HLS-Anfragen um CORS herum |
| `src-tauri/src/auth.rs` | twitch.tv-Login, Device-Code-Login, Helix-API |
| `src-tauri/src/points.rs`, `drops.rs` | Kanalpunkte und Drops |
| `src/lib/player.ts` | hls.js-Setup |
| `src/lib/irc.ts`, `src/lib/chat.ts` | IRC-Client, Chat-Store, Verlauf |
| `src/lib/emotes.ts`, `src/lib/seventv.ts` | 7TV / BTTV / FFZ, 7TV-EventAPI & Paints |
| `src/components/` | Oberfläche (Player, Multiview, Chat, Menüs) |

Absturz- und Fehlerprotokoll: `%APPDATA%\dev.nativ.twitchclient\nativ.log`

## Hinweise

Twitch bietet keine offizielle API für Video-Streams. Wie Streamlink nutzt die App dafür die Schnittstelle des Twitch-Web-Players – das kann Twitch jederzeit ändern.
Chatverlauf und ältere Nachrichten kommen von [recent-messages.robotty.de](https://recent-messages.robotty.de) bzw. [logs.ivr.fi](https://logs.ivr.fi) (in den Einstellungen abschaltbar).
