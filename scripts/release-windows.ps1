# Baut den signierten Windows-Installer + latest.json für den Auto-Updater.
# Der private Signaturschlüssel liegt NUR lokal (Standard: %USERPROFILE%\.tauri\muffintwitch-updater.key)
# und wird nie ins Repository oder zu GitHub hochgeladen.
param([string]$Key = "$env:USERPROFILE\.tauri\muffintwitch-updater.key", [string]$Notes = "")
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Key)) { throw "Signaturschlüssel nicht gefunden: $Key" }
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $Key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
try {
  npx tauri build --config src-tauri/tauri.release.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Build fehlgeschlagen" }
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
if ($Notes) { node scripts/make-latest-json.mjs $Notes } else { node scripts/make-latest-json.mjs }
