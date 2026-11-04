//! Twitch Drops: laufende Kampagnen, Fortschritt und Einsammeln.
//! Wie die Kanalpunkte nur mit dem twitch.tv-Login (Web-Token).

use crate::points::{gql, gql_persisted};
use crate::AppState;
use serde_json::{json, Value};
use tauri::State;

const INVENTORY_QUERY: &str = "query NativDropsInventory { currentUser { id inventory { dropCampaignsInProgress { id name status startAt endAt accountLinkURL game { id displayName boxArtURL } self { isAccountConnected } timeBasedDrops { id name startAt endAt requiredMinutesWatched benefitEdges { benefit { id name imageAssetURL } } self { hasPreconditionsMet currentMinutesWatched isClaimed dropInstanceID } } } gameEventDrops { id name imageURL lastAwardedAt totalCount } } } }";
const CAMPAIGNS_QUERY: &str = "query NativDropsCampaigns { currentUser { id dropCampaigns { id name status startAt endAt game { id displayName boxArtURL } self { isAccountConnected } } } }";
const CLAIM_MUTATION: &str = "mutation NativClaimDrop($input: ClaimDropRewardsInput!) { claimDropRewards(input: $input) { status } }";

const INVENTORY_HASH: &str = "37fea486d6179047c41d0f549088a4c3a7dd60c05c70956a1f262a3b0a4b23b9";
const CAMPAIGNS_HASH: &str = "8d5d9b5e3f088f9d1ff39eb2caab11f7a4cf7a3353da9ce82b5778226ff37268";
const CLAIM_HASH: &str = "a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930";

/// Erst eigene Abfrage, bei Fehler die gespeicherte Abfrage der Webseite.
async fn query_with_fallback(
    state: &State<'_, AppState>,
    op: &str,
    query: &str,
    persisted_op: &str,
    hash: &str,
) -> Result<Value, String> {
    match gql(state, json!({ "operationName": op, "query": query, "variables": {} })).await {
        Ok(r) if r["data"]["currentUser"].is_object() => Ok(r["data"]["currentUser"].clone()),
        first => {
            let r = gql_persisted(state, persisted_op, hash, json!({ "fetchRewardCampaigns": false }))
                .await
                .map_err(|e| match first {
                    Err(f) => format!("{f} / {e}"),
                    Ok(_) => e,
                })?;
            Ok(r["data"]["currentUser"].clone())
        }
    }
}

/// Drops, die gerade Fortschritt sammeln (inkl. einsammelbarer).
#[tauri::command]
pub async fn drops_inventory(state: State<'_, AppState>) -> Result<Value, String> {
    query_with_fallback(&state, "NativDropsInventory", INVENTORY_QUERY, "Inventory", INVENTORY_HASH).await
}

/// Alle aktuell verfügbaren Drop-Kampagnen.
#[tauri::command]
pub async fn drops_campaigns(state: State<'_, AppState>) -> Result<Value, String> {
    query_with_fallback(&state, "NativDropsCampaigns", CAMPAIGNS_QUERY, "ViewerDropsDashboard", CAMPAIGNS_HASH).await
}

#[tauri::command]
pub async fn claim_drop(state: State<'_, AppState>, drop_instance_id: String) -> Result<(), String> {
    let vars = json!({ "input": { "dropInstanceID": drop_instance_id } });
    let res = match gql_persisted(&state, "DropsPage_ClaimDropRewards", CLAIM_HASH, vars.clone()).await {
        Ok(r) if r["data"]["claimDropRewards"].is_object() => r,
        _ => gql(&state, json!({ "operationName": "NativClaimDrop", "query": CLAIM_MUTATION, "variables": vars }))
            .await
            .map_err(|e| format!("Drop einsammeln fehlgeschlagen – {e}"))?,
    };
    let status = res["data"]["claimDropRewards"]["status"].as_str().unwrap_or("");
    crate::log_line(&format!("Drop einsammeln: {status}"));
    match status {
        "ELIGIBLE_FOR_ALL" | "DROP_INSTANCE_ALREADY_CLAIMED" | "" if res["data"]["claimDropRewards"].is_object() => Ok(()),
        "" => Err("Drop einsammeln fehlgeschlagen: unerwartete Antwort".into()),
        other => Err(format!("Drop einsammeln: {other}")),
    }
}
