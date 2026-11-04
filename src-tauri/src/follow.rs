//! Kanälen folgen / entfolgen – mit dem twitch.tv-Login, wie der Folgen-Knopf auf der Webseite.
//! Verlangt Twitch dafür seinen Integritäts-Nachweis, öffnet die Oberfläche den Kanal im Browser.

use crate::points::{gql, gql_persisted};
use crate::AppState;
use serde_json::{json, Value};
use tauri::State;

const FOLLOW_HASH: &str = "800e7346bdf7e5278a3c1d3f21b2b56e2639928f86815677a7126b093b2fdd08";
const UNFOLLOW_HASH: &str = "f7dae976ebf41c755ae2d758546bfd176b4eeb856656098bb40e0a672ca0d880";

const FOLLOW_MUTATION: &str = "mutation NativFollowUser($input: FollowUserInput!) { followUser(input: $input) { follow { followedAt } error { code } } }";
const UNFOLLOW_MUTATION: &str = "mutation NativUnfollowUser($input: UnfollowUserInput!) { unfollowUser(input: $input) { follow { followedAt } } }";

#[tauri::command]
pub async fn follow_channel(state: State<'_, AppState>, target_id: String, follow: bool) -> Result<(), String> {
    let (op, hash, query, field, vars) = if follow {
        (
            "FollowButton_FollowUser",
            FOLLOW_HASH,
            FOLLOW_MUTATION,
            "followUser",
            json!({ "input": { "targetID": target_id, "disableNotifications": false } }),
        )
    } else {
        (
            "FollowButton_UnfollowUser",
            UNFOLLOW_HASH,
            UNFOLLOW_MUTATION,
            "unfollowUser",
            json!({ "input": { "targetID": target_id } }),
        )
    };

    // 1. Weg: wie die Twitch-Webseite (gespeicherte Abfrage), 2. Weg: eigene Abfrage
    let first = gql_persisted(&state, op, hash, vars.clone()).await;
    let res: Value = match first {
        Ok(r) if r["data"][field].is_object() => r,
        other => {
            if let Err(e) = &other {
                crate::log_line(&format!("Folgen (Web-Weg) fehlgeschlagen: {e}"));
            }
            let name = if follow { "NativFollowUser" } else { "NativUnfollowUser" };
            gql(&state, json!({ "operationName": name, "query": query, "variables": vars })).await?
        }
    };

    if let Some(code) = res["data"][field]["error"]["code"].as_str() {
        crate::log_line(&format!("Folgen: Fehlercode {code}"));
        return Err(format!("Twitch: {code}"));
    }
    if !res["data"][field].is_object() {
        crate::log_line(&format!("Folgen: unerwartete Antwort {res}"));
        return Err("Unerwartete Antwort von Twitch".into());
    }
    Ok(())
}
