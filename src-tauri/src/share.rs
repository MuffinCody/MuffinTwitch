//! Abo-Jubiläum (Resub) und Anschau-Serie (Watch Streak) im Chat teilen –
//! wie der „Teilen“-Hinweis über dem Chat auf twitch.tv.
//!
//! Verlangt Twitch dafür seinen Integritäts-Nachweis, öffnet die Oberfläche
//! den Kanal im Browser (dort kann man es mit einem Klick teilen).

use crate::points::gql;
use crate::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

const NOTIFICATIONS_QUERY: &str = "query NativChatNotifications($login: String!) { user(login: $login) { id self { resubNotification { id token cumulativeTenureMonths streakTenureMonths months } } channel { self { viewerMilestones { id category value } } } } }";
const SHARE_RESUB_MUTATION: &str = "mutation NativShareResub($input: UseChatNotificationTokenInput!) { useChatNotificationToken(input: $input) { isSuccess } }";
const SHARE_MILESTONE_MUTATION: &str = "mutation NativShareMilestone($input: ShareViewerMilestoneInput!) { shareViewerMilestone(input: $input) { error { code } milestone { id } } }";

#[derive(Serialize)]
pub struct Resub {
    id: String,
    token: String,
    /// Monate insgesamt
    months: i64,
    /// Monate am Stück (0 = nicht verfügbar)
    streak: i64,
}

#[derive(Serialize)]
pub struct Milestone {
    id: String,
    category: String,
    value: i64,
}

#[derive(Serialize)]
pub struct ChatNotifications {
    channel_id: String,
    resub: Option<Resub>,
    milestones: Vec<Milestone>,
}

fn s(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn valid_login(l: &str) -> bool {
    !l.is_empty() && l.len() <= 25 && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Gibt es gerade ein teilbares Abo-Jubiläum oder eine Anschau-Serie?
#[tauri::command]
pub async fn chat_notifications(state: State<'_, AppState>, channel: String) -> Result<ChatNotifications, String> {
    if !valid_login(&channel) {
        return Err("Ungültiger Kanal".into());
    }
    let res = gql(
        &state,
        json!({ "operationName": "NativChatNotifications", "query": NOTIFICATIONS_QUERY, "variables": { "login": channel } }),
    )
    .await?;
    let user = &res["data"]["user"];
    let rn = &user["self"]["resubNotification"];
    let resub = if rn.is_object() && !s(&rn["token"]).is_empty() {
        let months = rn["cumulativeTenureMonths"].as_i64().or_else(|| rn["months"].as_i64()).unwrap_or(0);
        Some(Resub {
            id: s(&rn["id"]),
            token: s(&rn["token"]),
            months,
            streak: rn["streakTenureMonths"].as_i64().unwrap_or(0),
        })
    } else {
        None
    };
    let milestones = user["channel"]["self"]["viewerMilestones"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| !s(&m["id"]).is_empty())
        .map(|m| Milestone { id: s(&m["id"]), category: s(&m["category"]), value: m["value"].as_i64().unwrap_or(0) })
        .collect();
    Ok(ChatNotifications { channel_id: s(&user["id"]), resub, milestones })
}

/// Abo-Jubiläum im Chat teilen (optional mit Nachricht und Serie).
#[tauri::command]
pub async fn share_resub(
    state: State<'_, AppState>,
    channel: String,
    token: String,
    include_streak: bool,
    message: String,
) -> Result<(), String> {
    if !valid_login(&channel) {
        return Err("Ungültiger Kanal".into());
    }
    let message: String = message.trim().chars().take(500).collect();
    let res = gql(
        &state,
        json!({
            "operationName": "NativShareResub",
            "query": SHARE_RESUB_MUTATION,
            "variables": { "input": { "channelLogin": channel, "tokenID": token, "includeStreak": include_streak, "message": message } }
        }),
    )
    .await?;
    if res["data"]["useChatNotificationToken"]["isSuccess"].as_bool() == Some(true) {
        Ok(())
    } else {
        crate::log_line(&format!("Abo teilen: unerwartete Antwort {res}"));
        Err("Twitch hat das Teilen abgelehnt".into())
    }
}

/// Anschau-Serie (Watch Streak) im Chat teilen.
#[tauri::command]
pub async fn share_milestone(state: State<'_, AppState>, channel_id: String, milestone_id: String) -> Result<(), String> {
    let res = gql(
        &state,
        json!({
            "operationName": "NativShareMilestone",
            "query": SHARE_MILESTONE_MUTATION,
            "variables": { "input": { "channelID": channel_id, "milestoneID": milestone_id } }
        }),
    )
    .await?;
    let p = &res["data"]["shareViewerMilestone"];
    if let Some(code) = p["error"]["code"].as_str() {
        crate::log_line(&format!("Serie teilen: Fehlercode {code}"));
        return Err(format!("Twitch: {code}"));
    }
    if p.is_object() {
        Ok(())
    } else {
        crate::log_line(&format!("Serie teilen: unerwartete Antwort {res}"));
        Err("Twitch hat das Teilen abgelehnt".into())
    }
}
