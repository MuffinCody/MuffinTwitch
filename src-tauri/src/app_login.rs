//! Optionale eigene Twitch-App (von https://dev.twitch.tv/console).
//!
//! Getrennt vom normalen twitch.tv-Login. Bringt zusätzlich:
//! * Flüstern (Whisper) – Twitch erlaubt das nur über die offizielle API
//! * die offizielle Helix-API als Ausweichweg für gefolgte Kanäle,
//!   Folgen-Status und eigene Emotes, falls Twitch seine Webseite ändert
//!
//! Anmeldung per Device Code Flow: Es wird nur die öffentliche Client-ID
//! gebraucht, kein Client-Secret.

use crate::auth::{check, AuthData, Check};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

const SCOPES: &str = "user:manage:whispers user:read:follows user:read:emotes";

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

fn valid_client_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

async fn refresh(http: &reqwest::Client, auth: &mut AuthData) -> bool {
    let Some(rt) = auth.refresh_token.clone() else { return false };
    let Ok(res) = http
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id", auth.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", rt.as_str()),
        ])
        .send()
        .await
    else {
        return false;
    };
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

/// Beim Start: App-Token prüfen und bei Bedarf erneuern.
pub(crate) async fn refresh_status(http: &reqwest::Client, auth: &mut AuthData) {
    let Some(token) = auth.access_token.clone() else { return };
    match check(http, &token).await {
        Check::Valid(v) => {
            auth.login = Some(v.login);
            auth.user_id = Some(v.user_id);
        }
        Check::Unreachable => {}
        Check::Invalid => {
            if refresh(http, auth).await {
                let t = auth.access_token.clone().unwrap_or_default();
                if let Check::Valid(v) = check(http, &t).await {
                    auth.login = Some(v.login);
                    auth.user_id = Some(v.user_id);
                    return;
                }
            }
            auth.clear_app();
        }
    }
}

#[tauri::command]
pub async fn app_login_start(state: State<'_, AppState>, client_id: String) -> Result<DeviceCode, String> {
    let id = client_id.trim().to_string();
    if !valid_client_id(&id) {
        return Err("Ungültige Client-ID".into());
    }
    {
        let mut auth = state.auth.lock().await;
        if auth.client_id != id {
            auth.clear_app();
        }
        auth.client_id = id.clone();
        auth.save(&state.auth_path);
    }
    let res = state
        .http
        .post("https://id.twitch.tv/oauth2/device")
        .form(&[("client_id", id.as_str()), ("scopes", SCOPES)])
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
pub async fn app_login_poll(state: State<'_, AppState>, device_code: String) -> Result<String, String> {
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
        let Check::Valid(v) = check(&state.http, &tok.access_token).await else {
            return Err("Token konnte nicht geprüft werden".into());
        };
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

/// Eigene App trennen (Token bei Twitch widerrufen). Der normale Login bleibt.
#[tauri::command]
pub async fn app_logout(state: State<'_, AppState>) -> Result<(), String> {
    let mut auth = state.auth.lock().await;
    if let Some(token) = auth.access_token.clone() {
        let _ = state
            .http
            .post("https://id.twitch.tv/oauth2/revoke")
            .form(&[("client_id", auth.client_id.as_str()), ("token", token.as_str())])
            .send()
            .await;
    }
    auth.clear_app();
    auth.save(&state.auth_path);
    Ok(())
}

/// Anfrage an die offizielle Helix-API mit dem App-Token (erneuert es bei Bedarf).
pub(crate) async fn helix(
    state: &State<'_, AppState>,
    method: reqwest::Method,
    path: &str,
    query: &[(&str, String)],
    body: Option<Value>,
) -> Result<Value, String> {
    let url = format!("https://api.twitch.tv/helix/{path}");
    for attempt in 0..2 {
        let (client_id, token) = {
            let auth = state.auth.lock().await;
            match (&auth.access_token, auth.has_app()) {
                (Some(t), true) => (auth.client_id.clone(), t.clone()),
                _ => return Err("Eigene Twitch-App nicht verbunden".into()),
            }
        };
        let mut req = state
            .http
            .request(method.clone(), &url)
            .query(query)
            .header("Client-ID", client_id)
            .header("Authorization", format!("Bearer {token}"));
        if let Some(b) = &body {
            req = req.json(b);
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status();
        if status.as_u16() == 401 && attempt == 0 {
            let mut auth = state.auth.lock().await;
            if refresh(&state.http, &mut auth).await {
                auth.save(&state.auth_path);
                continue;
            }
            auth.clear_app();
            auth.save(&state.auth_path);
            return Err("Eigene App: Sitzung abgelaufen – bitte neu verbinden".into());
        }
        if status.as_u16() == 204 {
            return Ok(Value::Null);
        }
        if !status.is_success() {
            let b: Value = res.json().await.unwrap_or_default();
            let msg = b["message"].as_str().unwrap_or("");
            return Err(format!("Twitch-API {}{}", status.as_u16(), if msg.is_empty() { String::new() } else { format!(": {msg}") }));
        }
        return res.json().await.map_err(|e| e.to_string());
    }
    Err("Twitch-API-Anfrage fehlgeschlagen".into())
}

pub(crate) async fn app_user_id(state: &State<'_, AppState>) -> Option<String> {
    let auth = state.auth.lock().await;
    if auth.has_app() {
        auth.user_id.clone()
    } else {
        None
    }
}

/// Flüstern – nur über die offizielle API möglich, daher nur mit eigener App.
#[tauri::command]
pub async fn send_whisper(state: State<'_, AppState>, to_user_id: String, message: String) -> Result<(), String> {
    let from = app_user_id(&state)
        .await
        .ok_or("Flüstern braucht die eigene Twitch-App (Einstellungen → Konto → Erweitert).")?;
    let msg = message.trim();
    if msg.is_empty() || msg.chars().count() > 500 {
        return Err("Nachricht leer oder zu lang".into());
    }
    if !to_user_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Ungültiger Empfänger".into());
    }
    helix(
        &state,
        reqwest::Method::POST,
        "whispers",
        &[("from_user_id", from), ("to_user_id", to_user_id)],
        Some(json!({ "message": msg })),
    )
    .await
    .map(|_| ())
}
