# MuffinTwitch

**[English](#english) · [Deutsch](#deutsch)**

> Unofficial fan project – not affiliated with Twitch Interactive, Inc.
> Inoffizielles Fanprojekt – steht in keiner Verbindung zu Twitch Interactive, Inc.

---

## English

A lightweight, native Twitch client for Windows and Linux – with **multiview**, **chat incl. 7TV/BTTV/FFZ** and lots of quality-of-life features.
Built with [Tauri 2](https://tauri.app) (Rust) and React. The app is only ~8 MB and uses the WebView2 runtime built into Windows.
The interface is available in **English and German** (Settings → General → Language).

### Download

Get the installer from **[Releases](../../releases/latest)**: download `MuffinTwitch_x.y.z_x64-setup.exe` and run it.
Everything the app needs is included – **Node.js is not required**. If WebView2 is missing (rare, it ships with Windows 11), the installer sets it up automatically.
Windows SmartScreen may warn because the file is not code-signed (“More info” → “Run anyway”).

**Linux** – packages are on the same release page:

| Distribution | File | Install |
| --- | --- | --- |
| Ubuntu / Debian / Mint | `MuffinTwitch_x.y.z_amd64.deb` | `sudo apt install ./MuffinTwitch_*_amd64.deb` |
| Fedora | `MuffinTwitch-x.y.z-1.x86_64.rpm` | `sudo dnf install ./MuffinTwitch-*.x86_64.rpm` |
| Arch / Manjaro / EndeavourOS | `muffintwitch-x.y.z-1-x86_64.pkg.tar.zst` | `sudo pacman -U ./muffintwitch-*.pkg.tar.zst` |
| Any distribution | `MuffinTwitch_x.y.z_amd64.AppImage` | `chmod +x MuffinTwitch_*.AppImage`, then run it |

Video needs an H.264 decoder (GStreamer). The .deb and the Arch package install it automatically, the AppImage brings its own.
On **Fedora** install it once with `sudo dnf install gstreamer1-plugin-openh264` (or `gstreamer1-plugin-libav` from RPM Fusion).

### Features

**Video**
- HLS player with quality selection, low latency and minimal YouTube-style controls
- Custom fullscreen mode (double-click / Esc) with optional chat beside the video
- With the twitch.tv login your **Turbo and sub benefits** apply (no ads)
- **Keyboard shortcuts**: Space play/pause, M mute, F fullscreen, C chat, ↑/↓ volume, L live, R reload, N next stream – changeable in Settings → Player

**Multiview**
- Up to 9 streams at once, grid or focus layout
- Audio focus by clicking a tile, multiview mode toggle next to the search
- “Stream Together”: shows streams sharing a chat with their partners

**Chat**
- Several channels as tabs + a combined “All” tab (with streamer avatars)
- Emotes from **7TV** (incl. zero-width, live updates, name paints and badges), **BTTV** and **FFZ**
- Emote picker, tab completion, mention sound, highlight words
- Slow down / delay chat, font and size, timestamps and more
- Recent chat history when opening a channel, user cards with older messages and mention
- **Reply** to messages (hover a message → reply button, Esc cancels)

**More**
- **Follow / unfollow** channels with the ♡ in the player
- Search for channels and categories, category browser with favorite categories
- Followed live channels with refresh button, sortable by viewers, recently watched or “recommended”
- Channel points (balance, rewards) and drops progress
- Favorites, last opened channels, shortcuts (**Ctrl+B** channel list, **Ctrl+J** chat)

### Login

Click **Log in** in the top right – the regular twitch.tv login page opens in its own window.
The app then uses that session (for chat, followed channels, Turbo/subs, channel points, drops).

The token is stored **locally only**: `%APPDATA%\dev.nativ.twitchclient\auth.json`. “Log out” deletes it and revokes it at Twitch.

**Channel points, drops & follows:** Twitch may only allow claiming bonus chests, rewards and drops (and sometimes following) through its own website (“integrity check”).
In that case the app opens the matching Twitch page in your browser.

No developer account or own Twitch app is needed – everything runs through the regular login.
Whispers are not supported, because Twitch only allows them on its own website.

### Build it yourself

Requirements: [Node.js](https://nodejs.org) (LTS), [Rust](https://rustup.rs) (MSVC), WebView2 (preinstalled on Windows 11).
On Linux additionally the Tauri system packages (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux)), e.g. `libwebkit2gtk-4.1-dev` on Ubuntu.

```bash
npm install
npm run app        # development mode with hot reload
npm run app:build  # release build (.exe + installer)
```

Output:
- `src-tauri/target/release/MuffinTwitch.exe`
- `src-tauri/target/release/bundle/nsis/MuffinTwitch_<version>_x64-setup.exe`

### Project structure

| Path | Contents |
| --- | --- |
| `src-tauri/src/stream.rs` | Fetch playback token, build HLS playlist URL |
| `src-tauri/src/proxy.rs` | `twproxy://` – routes HLS requests around CORS |
| `src-tauri/src/auth.rs` | twitch.tv login |
| `src-tauri/src/webapi.rs` | Data queries like the Twitch website (followed, search, categories, badges …) |
| `src-tauri/src/points.rs`, `drops.rs`, `follow.rs` | Channel points, drops, follow |
| `src/lib/player.ts` | hls.js setup |
| `src/lib/irc.ts`, `src/lib/chat.ts` | IRC client, chat store, history |
| `src/lib/emotes.ts`, `src/lib/seventv.ts` | 7TV / BTTV / FFZ, 7TV EventAPI & paints |
| `src/lib/i18n.ts`, `src/i18n/` | Translations (German is the source text, English dictionary) |
| `src/components/` | UI (player, multiview, chat, menus) |
| `.github/workflows/linux.yml`, `packaging/arch/` | Linux build (deb, rpm, AppImage, Arch package) |

Crash/error log: `%APPDATA%\dev.nativ.twitchclient\nativ.log`

### Notes

Twitch has no official API for video streams. Like Streamlink, the app uses the interface of the Twitch web player – Twitch may change it at any time.
Chat history and older messages come from [recent-messages.robotty.de](https://recent-messages.robotty.de) and [logs.ivr.fi](https://logs.ivr.fi) (can be turned off in the settings).

**Adding a language:** add a dictionary in `src/i18n/` (keys are the German texts) and register it in `src/lib/i18n.ts`.

---

## Deutsch

Ein schlanker, nativer Twitch-Client für Windows und Linux – mit **Multiview**, **Chat inkl. 7TV/BTTV/FFZ** und vielen Komfortfunktionen.
Gebaut mit [Tauri 2](https://tauri.app) (Rust) und React. Die App ist nur ~8 MB groß und nutzt das in Windows eingebaute WebView2.
Die Oberfläche gibt es auf **Deutsch und Englisch** (Einstellungen → Allgemein → Sprache).

### Download

Den Installer gibt es unter **[Releases](../../releases/latest)**: `MuffinTwitch_x.y.z_x64-setup.exe` herunterladen und ausführen.
Alles, was die App braucht, ist enthalten – **Node.js wird nicht benötigt**. Fehlt WebView2 (selten, bei Windows 11 vorinstalliert), richtet der Installer es automatisch ein.
Windows SmartScreen warnt eventuell, weil die Datei nicht signiert ist („Weitere Informationen“ → „Trotzdem ausführen“).

**Linux** – die Pakete liegen auf derselben Release-Seite:

| Distribution | Datei | Installieren |
| --- | --- | --- |
| Ubuntu / Debian / Mint | `MuffinTwitch_x.y.z_amd64.deb` | `sudo apt install ./MuffinTwitch_*_amd64.deb` |
| Fedora | `MuffinTwitch-x.y.z-1.x86_64.rpm` | `sudo dnf install ./MuffinTwitch-*.x86_64.rpm` |
| Arch / Manjaro / EndeavourOS | `muffintwitch-x.y.z-1-x86_64.pkg.tar.zst` | `sudo pacman -U ./muffintwitch-*.pkg.tar.zst` |
| Jede Distribution | `MuffinTwitch_x.y.z_amd64.AppImage` | `chmod +x MuffinTwitch_*.AppImage`, dann starten |

Für Video wird ein H.264-Decoder (GStreamer) gebraucht. Das .deb- und das Arch-Paket installieren ihn automatisch, das AppImage bringt ihn mit.
Unter **Fedora** einmalig `sudo dnf install gstreamer1-plugin-openh264` ausführen (oder `gstreamer1-plugin-libav` aus RPM Fusion).

### Funktionen

**Video**
- HLS-Player mit Qualitätsauswahl, niedriger Latenz und minimalistischen Steuerelementen im YouTube-Stil
- Eigener Vollbildmodus (Doppelklick / Esc), auf Wunsch mit Chat neben dem Video
- Mit twitch.tv-Login gelten **Turbo- und Abo-Vorteile** (keine Werbung)
- **Tastenkürzel**: Leertaste Abspielen/Pause, M stumm, F Vollbild, C Chat, ↑/↓ Lautstärke, L live, R neu laden, N nächster Stream – änderbar unter Einstellungen → Player

**Multiview**
- Bis zu 9 Streams gleichzeitig, Raster- oder Fokus-Layout
- Audio-Fokus per Klick auf eine Kachel, Multiview-Modus-Schalter neben der Suche
- „Stream Together“: zeigt gemeinsame Streams (geteilter Chat) samt Partnern an

**Chat**
- Mehrere Kanäle als Tabs + gemischter Tab „Alle“ (mit Streamer-Profilbildern)
- Emotes von **7TV** (inkl. Zero-Width, Live-Updates, Namensfarben/Paints und Badges), **BTTV** und **FFZ**
- Emote-Auswahl, Tab-Vervollständigung, Erwähnungen mit Ton, Highlight-Wörter
- Chat verlangsamen/verzögern, Schriftart/-größe, Zeitstempel u. v. m.
- Chatverlauf beim Öffnen, Nutzerkarte mit älteren Nachrichten und Erwähnen
- Auf Nachrichten **antworten** (Maus über die Nachricht → Antworten-Knopf, Esc bricht ab)

**Sonstiges**
- Kanälen **folgen / entfolgen** mit dem ♡ im Player
- Suche nach Kanälen und Kategorien, Kategorie-Übersicht mit Lieblingskategorien
- Gefolgte Live-Kanäle mit Aktualisieren-Knopf, sortierbar nach Zuschauern, zuletzt gesehen oder „Empfohlen“
- Kanalpunkte (Kontostand, Belohnungen) und Drops-Fortschritt
- Favoriten, zuletzt geöffnete Kanäle, Tastenkürzel (**Strg+B** Kanalliste, **Strg+J** Chat)

### Login

Oben rechts auf **Anmelden** klicken – die normale twitch.tv-Loginseite öffnet sich in einem eigenen Fenster.
Danach übernimmt die App die Sitzung (für Chat, gefolgte Kanäle, Turbo/Abo, Kanalpunkte, Drops).

Das Token wird **nur lokal** gespeichert: `%APPDATA%\dev.nativ.twitchclient\auth.json`. „Abmelden“ löscht es und widerruft es bei Twitch.

**Kanalpunkte, Drops & Folgen:** Twitch erlaubt das Einsammeln von Bonus-Truhen, Belohnungen und Drops (und teils das Folgen) nur über die eigene Webseite („integrity check“).
Die App öffnet dann die passende Twitch-Seite in deinem Browser.

Ein Entwickler-Konto oder eine eigene Twitch-App ist nicht nötig – alles läuft über den normalen Login.
Flüstern gibt es nicht, weil Twitch das nur auf der eigenen Webseite zulässt.

### Selbst bauen

Voraussetzungen: [Node.js](https://nodejs.org) (LTS), [Rust](https://rustup.rs) (MSVC), WebView2 (bei Windows 11 vorinstalliert).
Unter Linux zusätzlich die Tauri-Systempakete (siehe [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/#linux)), z. B. `libwebkit2gtk-4.1-dev` unter Ubuntu.

```bash
npm install
npm run app        # Entwicklungsmodus mit Hot-Reload
npm run app:build  # Release-Build (.exe + Installer)
```

Ergebnis:
- `src-tauri/target/release/MuffinTwitch.exe`
- `src-tauri/target/release/bundle/nsis/MuffinTwitch_<version>_x64-setup.exe`

### Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src-tauri/src/stream.rs` | Playback-Token holen, HLS-Playlist-URL bauen |
| `src-tauri/src/proxy.rs` | `twproxy://` – leitet HLS-Anfragen um CORS herum |
| `src-tauri/src/auth.rs` | twitch.tv-Login |
| `src-tauri/src/webapi.rs` | Datenabfragen wie die Twitch-Webseite (gefolgt, Suche, Kategorien, Abzeichen …) |
| `src-tauri/src/points.rs`, `drops.rs`, `follow.rs` | Kanalpunkte, Drops, Folgen |
| `src/lib/player.ts` | hls.js-Setup |
| `src/lib/irc.ts`, `src/lib/chat.ts` | IRC-Client, Chat-Store, Verlauf |
| `src/lib/emotes.ts`, `src/lib/seventv.ts` | 7TV / BTTV / FFZ, 7TV-EventAPI & Paints |
| `src/lib/i18n.ts`, `src/i18n/` | Übersetzungen (Deutsch ist der Ausgangstext, englisches Wörterbuch) |
| `src/components/` | Oberfläche (Player, Multiview, Chat, Menüs) |
| `.github/workflows/linux.yml`, `packaging/arch/` | Linux-Build (deb, rpm, AppImage, Arch-Paket) |

Absturz- und Fehlerprotokoll: `%APPDATA%\dev.nativ.twitchclient\nativ.log`

### Hinweise

Twitch bietet keine offizielle API für Video-Streams. Wie Streamlink nutzt die App dafür die Schnittstelle des Twitch-Web-Players – das kann Twitch jederzeit ändern.
Chatverlauf und ältere Nachrichten kommen von [recent-messages.robotty.de](https://recent-messages.robotty.de) bzw. [logs.ivr.fi](https://logs.ivr.fi) (in den Einstellungen abschaltbar).

**Weitere Sprache hinzufügen:** ein Wörterbuch in `src/i18n/` anlegen (Schlüssel sind die deutschen Texte) und in `src/lib/i18n.ts` eintragen.
