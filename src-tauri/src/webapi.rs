//! Alle Datenabfragen laufen wie auf der Twitch-Webseite (GQL), mit dem normalen
//! twitch.tv-Login. Die offizielle Helix-API nimmt dieses Token nicht an, deshalb
//! braucht niemand eine eigene Twitch-App.

use crate::points::{gql, gql_send};
use crate::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

const FOLLOWED_LIVE_QUERY: &str = "query NativFollowedLive($after: Cursor) { currentUser { followedLiveUsers(first: 100, after: $after) { edges { cursor node { id login displayName profileImageURL(width: 70) stream { id title type viewersCount createdAt game { name } } } } pageInfo { hasNextPage } } } }";
const IS_FOLLOWING_QUERY: &str = "query NativIsFollowing($id: ID!) { user(id: $id) { self { follower { followedAt } } } }";
const USER_EMOTES_QUERY: &str = "query NativUserEmotes { currentUser { emoteSets { id emotes { id token } } } }";

/// Gleiche Form wie ein Helix-Stream, damit die Oberfläche nichts unterscheiden muss.
#[derive(Serialize)]
pub struct WebStream {
    id: String,
    user_id: String,
    user_login: String,
    user_name: String,
    game_name: String,
    title: String,
    viewer_count: i64,
    started_at: String,
    thumbnail_url: String,
    profile_image_url: String,
}

/// Lese-Abfrage für die Oberfläche (Streams, Nutzer, Suche, Kategorien, Abzeichen …).
/// Nutzt den Login, falls vorhanden; Änderungen (mutations) sind hier nicht erlaubt.
#[tauri::command]
pub async fn twitch_gql(state: State<'_, AppState>, query: String, variables: Option<Value>) -> Result<Value, String> {
    if !query.trim_start().starts_with("query") {
        return Err("Nur Abfragen erlaubt".into());
    }
    let token = state.auth.lock().await.web_token.clone();
    let res = gql_send(
        &state,
        json!({ "query": query, "variables": variables.unwrap_or(json!({})) }),
        token,
    )
    .await?;
    Ok(res["data"].clone())
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

/// Gefolgte Kanäle, die gerade live sind (wie die Seitenleiste auf twitch.tv).
#[tauri::command]
pub async fn followed_live_web(state: State<'_, AppState>) -> Result<Vec<WebStream>, String> {
    let mut out = Vec::new();
    let mut after: Value = Value::Null;
    for _ in 0..10 {
        let res = gql(
            &state,
            json!({ "operationName": "NativFollowedLive", "query": FOLLOWED_LIVE_QUERY, "variables": { "after": after } }),
        )
        .await?;
        let conn = &res["data"]["currentUser"]["followedLiveUsers"];
        if conn.is_null() {
            return Err("Twitch hat keine Liste geliefert (Login abgelaufen?)".into());
        }
        let edges = conn["edges"].as_array().cloned().unwrap_or_default();
        for e in &edges {
            let n = &e["node"];
            let st = &n["stream"];
            if st.is_null() {
                continue;
            }
            let login = s(&n["login"]);
            out.push(WebStream {
                id: s(&st["id"]),
                user_id: s(&n["id"]),
                user_name: n["displayName"].as_str().map(String::from).unwrap_or_else(|| login.clone()),
                thumbnail_url: format!("https://static-cdn.jtvnw.net/previews-ttv/live_user_{login}-{{width}}x{{height}}.jpg"),
                user_login: login,
                game_name: s(&st["game"]["name"]),
                title: s(&st["title"]),
                viewer_count: st["viewersCount"].as_i64().unwrap_or(0),
                started_at: s(&st["createdAt"]),
                profile_image_url: s(&n["profileImageURL"]),
            });
        }
        if !conn["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) {
            break;
        }
        match edges.last().map(|e| e["cursor"].clone()) {
            Some(c) if c.is_string() => after = c,
            _ => break,
        }
    }
    Ok(out)
}

/// Folgt der angemeldete Nutzer diesem Kanal?
#[tauri::command]
pub async fn is_following_web(state: State<'_, AppState>, channel_id: String) -> Result<bool, String> {
    let res = gql(
        &state,
        json!({ "operationName": "NativIsFollowing", "query": IS_FOLLOWING_QUERY, "variables": { "id": channel_id } }),
    )
    .await?;
    let user = &res["data"]["user"];
    if user["self"].is_null() {
        return Err("Folgen-Status nicht verfügbar".into());
    }
    Ok(!user["self"]["follower"].is_null())
}

#[derive(Serialize)]
pub struct WebEmote {
    id: String,
    name: String,
}

/// Eigene Twitch-Emotes (Abos, Turbo, Global …).
#[tauri::command]
pub async fn user_emotes_web(state: State<'_, AppState>) -> Result<Vec<WebEmote>, String> {
    let res = gql(&state, json!({ "operationName": "NativUserEmotes", "query": USER_EMOTES_QUERY })).await?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for set in res["data"]["currentUser"]["emoteSets"].as_array().into_iter().flatten() {
        for e in set["emotes"].as_array().into_iter().flatten() {
            let id = s(&e["id"]);
            let name = s(&e["token"]);
            if !id.is_empty() && !name.is_empty() && seen.insert(id.clone()) {
                out.push(WebEmote { id, name });
            }
        }
    }
    Ok(out)
}
