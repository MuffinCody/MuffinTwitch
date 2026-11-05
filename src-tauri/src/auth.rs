//! Twitch-Login: Die echte twitch.tv-Loginseite öffnet sich in einem eigenen
//! Fenster. Danach wird das Sitzungs-Token (`auth-token`-Cookie) übernommen –
//! damit laufen Chat, gefolgte Kanäle, Kanalpunkte und Turbo/Abo ohne Werbung.

use crate::stream::WEB_CLIENT_ID;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const LOGIN_WINDOW: &str = "twitch-login";

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct AuthData {
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

    fn clear(&mut self) {
        self.web_token = None;
        self.web_login = None;
        self.web_user_id = None;
    }

    fn logged_in(&self) -> bool {
        self.web_token.is_some() && self.web_login.is_some()
    }
}

#[derive(Serialize)]
pub struct AuthInfo {
    logged_in: bool,
    login: Option<String>,
    user_id: Option<String>,
}

impl From<&AuthData> for AuthInfo {
    fn from(a: &AuthData) -> Self {
        AuthInfo {
            logged_in: a.logged_in(),
            login: a.web_login.clone(),
            user_id: a.web_user_id.clone(),
        }
    }
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

/// Prüft das gespeicherte Token und liefert den Status.
#[tauri::command]
pub async fn auth_get(state: State<'_, AppState>) -> Result<AuthInfo, String> {
    let mut auth = state.auth.lock().await;
    if let Some(token) = auth.web_token.clone() {
        match check(&state.http, &token).await {
            Check::Valid(v) => {
                auth.web_login = Some(v.login);
                auth.web_user_id = Some(v.user_id);
            }
            Check::Unreachable => {}
            Check::Invalid => auth.clear(),
        }
        // speichert auch alte Dateien ohne die früheren App-Login-Felder neu
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
            let Check::Valid(v) = check(&state.http, &token).await else { continue };
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

/// Abmelden: Token bei Twitch widerrufen und lokal löschen.
#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> Result<(), String> {
    let mut auth = state.auth.lock().await;
    if let Some(token) = auth.web_token.clone() {
        let _ = state
            .http
            .post("https://id.twitch.tv/oauth2/revoke")
            .form(&[("client_id", WEB_CLIENT_ID), ("token", token.as_str())])
            .send()
            .await;
    }
    auth.clear();
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
    if let (true, Some(l), Some(t)) = (auth.logged_in(), &auth.web_login, &auth.web_token) {
        return Ok(Some(ChatCredentials { login: l.clone(), token: t.clone() }));
    }
    Ok(None)
}
