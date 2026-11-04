//! Twitch-Login + Helix-API-Aufrufe.
//!
//! Zwei Arten von Login:
//! * **Web-Login** (Standard): Die echte twitch.tv-Loginseite öffnet sich in einem
//!   eigenen Fenster. Danach wird das Sitzungs-Token (`auth-token`-Cookie) übernommen.
//!   Nur damit gelten Turbo-/Abo-Vorteile (keine Werbung) beim Video.
//! * **App-Login** (optional): Device Code Flow mit eigener Client-ID von
//!   https://dev.twitch.tv/console – offizieller Weg für Chat/Helix.

use crate::stream::WEB_CLIENT_ID;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const SCOPES: &str = "chat:read chat:edit user:read:follows user:read:emotes user:manage:whispers";
const LOGIN_WINDOW: &str = "twitch-login";

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct AuthData {
    #[serde(default)]
    pub client_id: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub login: Option<String>,
    pub user_id: Option<String>,
    // Web-Login (twitch.tv-Sitzung)
    pub web_token: Option<String>,
    pub web_login: Option<String>,
    pub web_user_id: Option<String>,
}

impl AuthData {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(&self, path: &Path) {
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, s);
        }
    }

    fn clear_app(&mut self) {
        self.access_token = None;
        self.refresh_token = None;
        self.login = None;
        self.user_id = None;
    }

    fn clear_web(&mut self) {
        self.web_token = None;
        self.web_login = None;
        self.web_user_id = None;
    }

    fn has_app(&self) -> bool {
        self.access_token.is_some() && self.login.is_some()
    }

    fn has_web(&self) -> bool {
        self.web_token.is_some() && self.web_login.is_some()
    }

    /// Client-ID + Token für Helix/IRC: App-Token bevorzugt, sonst Web-Token.
    fn api_creds(&self) -> Option<(String, String, bool)> {
        if let (true, Some(t)) = (self.has_app(), &self.access_token) {
            return Some((self.client_id.clone(), t.clone(), false));
        }
        if let (true, Some(t)) = (self.has_web(), &self.web_token) {
            return Some((WEB_CLIENT_ID.to_string(), t.clone(), true));
        }
        None
    }
}

#[derive(Serialize)]
pub struct AuthInfo {
    client_id: String,
    logged_in: bool,
    login: Option<String>,
    user_id: Option<String>,
    /// Web-Login aktiv → Turbo/Abo-Vorteile beim Video
    web: bool,
    /// Eigene App (Device Code) verbunden
    app: bool,
}

impl From<&AuthData> for AuthInfo {
    fn from(a: &AuthData) -> Self {
        let (login, user_id) = if a.has_app() {
            (a.login.clone(), a.user_id.clone())
        } else {
            (a.web_login.clone(), a.web_user_id.clone())
        };
        AuthInfo {
            client_id: a.client_id.clone(),
            logged_in: a.has_app() || a.has_web(),
            login,
            user_id,
            web: a.has_web(),
            app: a.has_app(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct ValidateResponse {
    login: String,
    user_id: String,
}

/// Ergebnis der Token-Prüfung: gültig, ungültig (401) oder nicht erreichbar.
enum Check {
    Valid(ValidateResponse),
    Invalid,
    Unreachable,
}

async fn check(http: &reqwest::Client, token: &str) -> Check {
    let res = http
        .get("https://id.twitch.tv/oauth2/validate")
        .header("Authorization", format!("OAuth {token}"))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => Check::Valid(v),
            Err(_) => Check::Unreachable,
        },
        Ok(r) if r.status().as_u16() == 401 => Check::Invalid,
        _ => Check::Unreachable,
    }
}

async fn validate(http: &reqwest::Client, token: &str) -> Option<ValidateResponse> {
    match check(http, token).await {
        Check::Valid(v) => Some(v),
        _ => None,
    }
}

async fn refresh(http: &reqwest::Client, auth: &mut AuthData) -> bool {
    let Some(rt) = auth.refresh_token.clone() else { return false };
    let res = http
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id", auth.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", rt.as_str()),
        ])
        .send()
        .await;
    let Ok(res) = res else { return false };
    if !res.status().is_success() {
        return false;
    }
    let Ok(tok) = res.json::<TokenResponse>().await else { return false };
    auth.access_token = Some(tok.access_token);
    if tok.refresh_token.is_some() {
        auth.refresh_token = tok.refresh_token;
    }
    true
}

/// Prüft die gespeicherten Tokens, erneuert sie bei Bedarf und liefert den Status.
#[tauri::command]
pub async fn auth_get(state: State<'_, AppState>) -> Result<AuthInfo, String> {
    let mut auth = state.auth.lock().await;
    let mut dirty = false;

    if let Some(token) = auth.access_token.clone() {
        dirty = true;
        match check(&state.http, &token).await {
            Check::Valid(v) => {
                auth.login = Some(v.login);
                auth.user_id = Some(v.user_id);
            }
            Check::Unreachable => {}
            Check::Invalid => {
                let ok = refresh(&state.http, &mut auth).await;
                let t = auth.access_token.clone().unwrap_or_default();
                match (ok, validate(&state.http, &t).await) {
                    (true, Some(v)) => {
                        auth.login = Some(v.login);
                        auth.user_id = Some(v.user_id);
                    }
                    _ => auth.clear_app(),
                }
            }
        }
    }

    if let Some(token) = auth.web_token.clone() {
        dirty = true;
        match check(&state.http, &token).await {
            Check::Valid(v) => {
                auth.web_login = Some(v.login);
                auth.web_user_id = Some(v.user_id);
            }
            Check::Unreachable => {}
            Check::Invalid => auth.clear_web(),
        }
    }

    if dirty {
        auth.save(&state.auth_path);
    }
    Ok(AuthInfo::from(&*auth))
}

/// Öffnet die twitch.tv-Loginseite in einem eigenen Fenster und übernimmt
/// nach erfolgreichem Login das Sitzungs-Token.
#[tauri::command]
pub async fn auth_web_login(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = w.set_focus();
        return Ok(());
    }
    let url: url::Url = "https://www.twitch.tv/login".parse().unwrap();
    // Privatmodus: Die Browsersitzung bleibt nicht im App-Profil liegen.
    // Das Fenster hat keinerlei Zugriff auf App-Befehle (keine Capability).
    WebviewWindowBuilder::new(&app, LOGIN_WINDOW, WebviewUrl::External(url))
        .title("Bei Twitch anmelden")
        .inner_size(520.0, 780.0)
        .incognito(true)
        .build()
        .map_err(|e| e.to_string())?;

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let twitch: url::Url = "https://www.twitch.tv".parse().unwrap();
        // max. 15 Minuten warten
        for _ in 0..1100 {
            tokio::time::sleep(Duration::from_millis(800)).await;
            let Some(w) = app2.get_webview_window(LOGIN_WINDOW) else { return };
            let Ok(cookies) = w.cookies_for_url(twitch.clone()) else { continue };
            let Some(token) = cookies
                .iter()
                .find(|c| c.name() == "auth-token" && !c.value().is_empty())
                .map(|c| c.value().to_string())
            else {
                continue;
            };
            let state = app2.state::<AppState>();
            let Some(v) = validate(&state.http, &token).await else { continue };
            {
                let mut auth = state.auth.lock().await;
                auth.web_token = Some(token);
                auth.web_login = Some(v.login);
                auth.web_user_id = Some(v.user_id);
                auth.save(&state.auth_path);
            }
            let _ = w.close();
            let _ = app2.emit("auth-changed", ());
            return;
        }
        if let Some(w) = app2.get_webview_window(LOGIN_WINDOW) {
            let _ = w.close();
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn auth_set_client_id(state: State<'_, AppState>, client_id: String) -> Result<(), String> {
    let mut auth = state.auth.lock().await;
    let id = client_id.trim().to_string();
    if id != auth.client_id {
        auth.clear_app();
    }
    auth.client_id = id;
    auth.save(&state.auth_path);
    Ok(())
}

#[tauri::command]
pub async fn auth_start(state: State<'_, AppState>) -> Result<DeviceCode, String> {
    let client_id = state.auth.lock().await.client_id.clone();
    if client_id.is_empty() {
        return Err("Bitte zuerst eine Client-ID eintragen.".into());
    }
    let res = state
        .http
        .post("https://id.twitch.tv/oauth2/device")
        .form(&[("client_id", client_id.as_str()), ("scopes", SCOPES)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let body: Value = res.json().await.unwrap_or_default();
        return Err(format!(
            "Twitch lehnt die Anmeldung ab: {}",
            body["message"].as_str().unwrap_or("unbekannter Fehler")
        ));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// Liefert "pending", "ok" oder einen Fehler.
#[tauri::command]
pub async fn auth_poll(state: State<'_, AppState>, device_code: String) -> Result<String, String> {
    let client_id = state.auth.lock().await.client_id.clone();
    let res = state
        .http
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("scopes", SCOPES),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let tok: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
        let v = validate(&state.http, &tok.access_token)
            .await
            .ok_or("Token konnte nicht geprüft werden")?;
        let mut auth = state.auth.lock().await;
        auth.access_token = Some(tok.access_token);
        auth.refresh_token = tok.refresh_token;
        auth.login = Some(v.login);
        auth.user_id = Some(v.user_id);
        auth.save(&state.auth_path);
        return Ok("ok".into());
    }

    let body: Value = res.json().await.unwrap_or_default();
    match body["message"].as_str().unwrap_or("") {
        "authorization_pending" | "slow_down" => Ok("pending".into()),
        "expired_token" | "invalid device code" => Err("Code abgelaufen – bitte erneut versuchen.".into()),
        "access_denied" => Err("Anmeldung abgelehnt.".into()),
        other => Err(format!("Anmeldung fehlgeschlagen: {other}")),
    }
}

async fn revoke(http: &reqwest::Client, client_id: &str, token: &str) {
    let _ = http
        .post("https://id.twitch.tv/oauth2/revoke")
        .form(&[("client_id", client_id), ("token", token)])
        .send()
        .await;
}

/// `which`: "all", "web" oder "app"
#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>, which: Option<String>) -> Result<(), String> {
    let which = which.unwrap_or_else(|| "all".into());
    let mut auth = state.auth.lock().await;
    if which != "web" {
        if let Some(token) = auth.access_token.clone() {
            revoke(&state.http, &auth.client_id.clone(), &token).await;
        }
        auth.clear_app();
    }
    if which != "app" {
        if let Some(token) = auth.web_token.clone() {
            revoke(&state.http, WEB_CLIENT_ID, &token).await;
        }
        auth.clear_web();
    }
    auth.save(&state.auth_path);
    Ok(())
}

#[derive(Serialize)]
pub struct ChatCredentials {
    login: String,
    token: String,
}

/// Zugangsdaten für den IRC-Chat (Senden von Nachrichten).
#[tauri::command]
pub async fn auth_chat_credentials(state: State<'_, AppState>) -> Result<Option<ChatCredentials>, String> {
    let auth = state.auth.lock().await;
    if let (true, Some(l), Some(t)) = (auth.has_app(), &auth.login, &auth.access_token) {
        return Ok(Some(ChatCredentials { login: l.clone(), token: t.clone() }));
    }
    if let (true, Some(l), Some(t)) = (auth.has_web(), &auth.web_login, &auth.web_token) {
        return Ok(Some(ChatCredentials { login: l.clone(), token: t.clone() }));
    }
    Ok(None)
}


async fn helix_request(
    state: &State<'_, AppState>,
    method: reqwest::Method,
    path: &str,
    query: &[(String, String)],
    body: Option<&Value>,
) -> Result<Value, String> {
    if path.contains("..") || path.starts_with('/') || path.contains("://") {
        return Err("Ungültiger Pfad".into());
    }
    let url = format!("https://api.twitch.tv/helix/{path}");

    for attempt in 0..2 {
        let Some((client_id, token, is_web)) = state.auth.lock().await.api_creds() else {
            return Err("Nicht angemeldet".into());
        };
        let mut req = state
            .http
            .request(method.clone(), &url)
            .query(query)
            .header("Client-ID", client_id)
            .header("Authorization", format!("Bearer {token}"));
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await.map_err(|e| e.to_string())?;

        if res.status().as_u16() == 401 && attempt == 0 && !is_web {
            let mut auth = state.auth.lock().await;
            if refresh(&state.http, &mut auth).await {
                auth.save(&state.auth_path);
                continue;
            }
            auth.clear_app();
            auth.save(&state.auth_path);
            return Err("Sitzung abgelaufen – bitte neu anmelden".into());
        }
        let status = res.status();
        if status.as_u16() == 204 {
            return Ok(Value::Null);
        }
        if !status.is_success() {
            let body: Value = res.json().await.unwrap_or_default();
            let msg = body["message"].as_str().unwrap_or("");
            return Err(format!("Helix-Fehler {}{}", status.as_u16(), if msg.is_empty() { String::new() } else { format!(": {msg}") }));
        }
        return res.json().await.map_err(|e| e.to_string());
    }
    Err("Helix-Anfrage fehlgeschlagen".into())
}

/// Generischer GET auf die Helix-API, z. B. `streams/followed`.
#[tauri::command]
pub async fn helix(
    state: State<'_, AppState>,
    path: String,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    helix_request(&state, reqwest::Method::GET, &path, &query, None).await
}

/// POST auf die Helix-API (z. B. `whispers`).
#[tauri::command]
pub async fn helix_post(
    state: State<'_, AppState>,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
) -> Result<Value, String> {
    helix_request(&state, reqwest::Method::POST, &path, &query, Some(&body)).await
}