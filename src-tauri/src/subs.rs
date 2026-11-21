//! Abo-Status für den Abo-Knopf im Player.
//! Abonnieren selbst läuft (wegen der Bezahlung) immer auf twitch.tv im Browser.

use crate::points::gql;
use crate::AppState;
use serde::Serialize;
use serde_json::json;
use tauri::State;

const SUB_QUERY: &str = "query NativSubStatus($login: String!) { user(login: $login) { subscriptionProducts { id } self { subscriptionBenefit { id tier purchasedWithPrime endsAt renewsAt gift { isGift } } subscriptionTenure(tenureMethod: CUMULATIVE) { months } } } }";

#[derive(Serialize)]
pub struct SubStatus {
    /// Kanal bietet Abos an (Affiliate/Partner)
    can_subscribe: bool,
    subscribed: bool,
    /// "1000", "2000", "3000"
    tier: Option<String>,
    prime: bool,
    gift: bool,
    months: i64,
    renews_at: Option<String>,
    ends_at: Option<String>,
}

#[tauri::command]
pub async fn sub_status(state: State<'_, AppState>, channel: String) -> Result<SubStatus, String> {
    if channel.is_empty() || channel.len() > 25 || !channel.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Ungültiger Kanal".into());
    }
    let res = gql(&state, json!({ "operationName": "NativSubStatus", "query": SUB_QUERY, "variables": { "login": channel } })).await?;
    let user = &res["data"]["user"];
    let benefit = &user["self"]["subscriptionBenefit"];
    let str_opt = |v: &serde_json::Value| v.as_str().filter(|s| !s.is_empty()).map(String::from);
    Ok(SubStatus {
        can_subscribe: user["subscriptionProducts"].as_array().map(|a| !a.is_empty()).unwrap_or(false),
        subscribed: benefit.is_object(),
        tier: str_opt(&benefit["tier"]),
        prime: benefit["purchasedWithPrime"].as_bool().unwrap_or(false),
        gift: benefit["gift"]["isGift"].as_bool().unwrap_or(false),
        months: user["self"]["subscriptionTenure"]["months"].as_i64().unwrap_or(0),
        renews_at: str_opt(&benefit["renewsAt"]),
        ends_at: str_opt(&benefit["endsAt"]),
    })
}
