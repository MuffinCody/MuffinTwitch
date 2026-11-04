//! Holt die HLS-Master-Playlist für einen Live-Kanal.
//!
//! Twitch bietet dafür keine offizielle API. Wie Streamlink & Co. wird hier
//! ein Playback-Access-Token über die GQL-Schnittstelle des Web-Players
//! angefordert und damit die Usher-URL gebaut.

use crate::AppState;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const GQL_URL: &str = "https://gql.twitch.tv/gql";
pub const WEB_CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const PLAYBACK_QUERY: &str = "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature } videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature } }";

fn is_valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 25
        && login.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[tauri::command]
pub async fn get_stream_url(state: State<'_, AppState>, login: String) -> Result<String, String> {
    let login = login.trim().to_lowercase();
    if !is_valid_login(&login) {
        return Err("Ungültiger Kanalname".into());
    }

    let body = json!({
        "operationName": "PlaybackAccessToken_Template",
        "query": PLAYBACK_QUERY,
        "variables": {
            "isLive": true,
            "login": login,
            "isVod": false,
            "vodID": "",
            "playerType": "site"
        }
    });

    // Mit Web-Login: Konto mitschicken → Turbo/Abo-Vorteile (keine Werbung)
    let web_token = state.auth.lock().await.web_token.clone();

    let request = |auth: Option<&str>| {
        let mut req = state.http.post(GQL_URL).header("Client-ID", WEB_CLIENT_ID).json(&body);
        if let Some(t) = auth {
            req = req.header("Authorization", format!("OAuth {t}"));
        }
        async move {
            req.send()
                .await
                .map_err(|e| format!("Netzwerkfehler: {e}"))?
                .json::<Value>()
                .await
                .map_err(|e| format!("Ungültige Antwort: {e}"))
        }
    };

    let mut res = request(web_token.as_deref()).await?;
    if web_token.is_some() && res["data"]["streamPlaybackAccessToken"]["value"].is_null() {
        // Token abgelaufen o. Ä. → anonym erneut versuchen, damit das Video trotzdem läuft
        res = request(None).await?;
    }

    let token = &res["data"]["streamPlaybackAccessToken"];
    let (Some(value), Some(sig)) = (token["value"].as_str(), token["signature"].as_str()) else {
        if let Some(msg) = res["errors"][0]["message"].as_str() {
            return Err(format!("Twitch: {msg}"));
        }
        return Err("Kanal nicht gefunden".into());
    };

    let p = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() % 9_999_999)
        .unwrap_or(1234);

    let mut url = url::Url::parse(&format!("https://usher.ttvnw.net/api/channel/hls/{login}.m3u8"))
        .map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("allow_source", "true")
        .append_pair("allow_audio_only", "true")
        .append_pair("fast_bread", "true")
        .append_pair("player_backend", "mediaplayer")
        .append_pair("playlist_include_framerate", "true")
        .append_pair("supported_codecs", "avc1")
        .append_pair("p", &p.to_string())
        .append_pair("sig", sig)
        .append_pair("token", value);

    Ok(url.to_string())
}
