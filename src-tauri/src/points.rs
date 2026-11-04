//! Kanalpunkte: Kontostand abfragen und Bonus-Truhe einsammeln.
//! Funktioniert nur mit dem twitch.tv-Login (Web-Token), wie im Browser.

use crate::stream::WEB_CLIENT_ID;
use crate::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

const GQL_URL: &str = "https://gql.twitch.tv/gql";

const POINTS_QUERY: &str = "query NativChannelPoints($login: String!) { user(login: $login) { id channel { self { communityPoints { balance availableClaim { id } } } } } }";
const CLAIM_MUTATION: &str = "mutation NativClaimPoints($input: ClaimCommunityPointsInput!) { claimCommunityPoints(input: $input) { claim { id } error { code } } }";

#[derive(Serialize)]
pub struct ChannelPoints {
    channel_id: String,
    balance: Option<i64>,
    claim_id: Option<String>,
}

/// GQL-Anfrage mit dem twitch.tv-Login (Web-Token). Fehler werden in nativ.log protokolliert.
pub(crate) async fn gql(state: &State<'_, AppState>, body: Value) -> Result<Value, String> {
    let op = body["operationName"].as_str().unwrap_or("?").to_string();
    let token = state
        .auth
        .lock()
        .await
        .web_token
        .clone()
        .ok_or("Dafür ist der twitch.tv-Login nötig")?;
    let res = state
        .http
        .post(GQL_URL)
        .header("Client-ID", WEB_CLIENT_ID)
        .header("Authorization", format!("OAuth {token}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let res: Value = res.json().await.map_err(|e| {
        crate::log_line(&format!("GQL {op}: HTTP {status}, keine JSON-Antwort ({e})"));
        format!("Twitch-Antwort {status}")
    })?;
    if let Some(msg) = res["errors"][0]["message"].as_str() {
        crate::log_line(&format!("GQL {op}: {msg}"));
        return Err(format!("Twitch: {msg}"));
    }
    if let Some(msg) = res["error"].as_str() {
        let detail = res["message"].as_str().unwrap_or("");
        crate::log_line(&format!("GQL {op}: {msg} {detail}"));
        return Err(format!("Twitch: {msg} {detail}"));
    }
    Ok(res)
}

/// Dieselbe Operation, wie sie die Twitch-Webseite schickt (gespeicherte Abfrage per Hash).
pub(crate) async fn gql_persisted(
    state: &State<'_, AppState>,
    operation: &str,
    hash: &str,
    variables: Value,
) -> Result<Value, String> {
    gql(
        state,
        json!({
            "operationName": operation,
            "variables": variables,
            "extensions": { "persistedQuery": { "version": 1, "sha256Hash": hash } }
        }),
    )
    .await
}

const CLAIM_HASH: &str ="46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0";

#[tauri::command]
pub async fn channel_points(state: State<'_, AppState>, login: String) -> Result<ChannelPoints, String> {
    let res = gql(
        &state,
        json!({ "operationName": "NativChannelPoints", "query": POINTS_QUERY, "variables": { "login": login } }),
    )
    .await?;
    let user = &res["data"]["user"];
    let cp = &user["channel"]["self"]["communityPoints"];
    Ok(ChannelPoints {
        channel_id: user["id"].as_str().unwrap_or_default().to_string(),
        balance: cp["balance"].as_i64(),
        claim_id: cp["availableClaim"]["id"].as_str().map(String::from),
    })
}

const MENU_QUERY: &str = "query NativPointsMenu($login: String!) { user(login: $login) { id displayName channel { self { communityPoints { balance availableClaim { id } } } communityPointsSettings { name image { url url2x } customRewards { id title cost prompt isUserInputRequired isEnabled isPaused isInStock isSubOnly backgroundColor cooldownExpiresAt image { url url2x } defaultImage { url url2x } } } } } }";
const REDEEM_MUTATION: &str = "mutation NativRedeem($input: RedeemCommunityPointsCustomRewardInput!) { redeemCommunityPointsCustomReward(input: $input) { error { code } redemption { id } } }";

/// Daten fürs Kanalpunkte-Menü: Name/Symbol der Punkte + Belohnungen.
#[tauri::command]
pub async fn points_menu(state: State<'_, AppState>, login: String) -> Result<Value, String> {
    let res = gql(
        &state,
        json!({ "operationName": "NativPointsMenu", "query": MENU_QUERY, "variables": { "login": login } }),
    )
    .await?;
    Ok(res["data"]["user"].clone())
}

#[tauri::command]
pub async fn redeem_reward(
    state: State<'_, AppState>,
    channel_id: String,
    reward_id: String,
    cost: i64,
    title: String,
    prompt: Option<String>,
    text_input: Option<String>,
) -> Result<(), String> {
    let tx = format!(
        "{:032x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let mut input = json!({
        "channelID": channel_id,
        "cost": cost,
        "rewardID": reward_id,
        "title": title,
        "prompt": prompt,
        "transactionID": tx,
    });
    if let Some(t) = text_input.filter(|t| !t.is_empty()) {
        input["textInput"] = json!(t);
    }
    let res = gql(
        &state,
        json!({ "operationName": "NativRedeem", "query": REDEEM_MUTATION, "variables": { "input": input } }),
    )
    .await?;
    if let Some(code) = res["data"]["redeemCommunityPointsCustomReward"]["error"]["code"].as_str() {
        return Err(match code {
            "NOT_ENOUGH_POINTS" => "Nicht genug Kanalpunkte.".into(),
            "REWARD_PAUSED" | "DISABLED" => "Diese Belohnung ist gerade pausiert.".into(),
            "OUT_OF_STOCK" | "MAX_PER_STREAM" | "MAX_PER_USER_PER_STREAM" => "Für diesen Stream ausgeschöpft.".into(),
            "GLOBAL_COOLDOWN" => "Belohnung ist noch im Cooldown.".into(),
            other => format!("Einlösen fehlgeschlagen: {other}"),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn claim_points(state: State<'_, AppState>, channel_id: String, claim_id: String) -> Result<(), String> {
    let vars = json!({ "input": { "channelID": channel_id, "claimID": claim_id } });

    // 1. Weg: wie die Twitch-Webseite (gespeicherte Abfrage)
    let first = gql_persisted(&state, "ClaimCommunityPoints", CLAIM_HASH, vars.clone()).await;
    // 2. Weg: eigene Abfrage
    let res = match first {
        Ok(r) if r["data"]["claimCommunityPoints"].is_object() => r,
        other => {
            if let Err(e) = &other {
                crate::log_line(&format!("Kanalpunkte (Web-Weg) fehlgeschlagen: {e}"));
            }
            gql(&state, json!({ "operationName": "NativClaimPoints", "query": CLAIM_MUTATION, "variables": vars }))
                .await
                .map_err(|e| format!("Einsammeln fehlgeschlagen – {e}"))?
        }
    };

    if let Some(code) = res["data"]["claimCommunityPoints"]["error"]["code"].as_str() {
        crate::log_line(&format!("Kanalpunkte: Fehlercode {code}"));
        return Err(format!("Einsammeln fehlgeschlagen: {code}"));
    }
    if !res["data"]["claimCommunityPoints"].is_object() {
        crate::log_line(&format!("Kanalpunkte: unerwartete Antwort {res}"));
        return Err("Einsammeln fehlgeschlagen: unerwartete Antwort von Twitch".into());
    }
    crate::log_line("Kanalpunkte: Bonus eingesammelt");
    Ok(())
}
