//! `twproxy://` – leitet HLS-Anfragen des WebViews über Rust weiter.
//!
//! Das WebView darf Twitch-CDNs wegen CORS nicht direkt abfragen. hls.js
//! schreibt daher jede URL auf `twproxy://localhost/<url-encoded>` um
//! (unter Windows `http://twproxy.localhost/...`). Playlists werden dabei so
//! umgeschrieben, dass alle enthaltenen URIs absolut sind.

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

const ALLOWED_HOSTS: &[&str] = &[
    "ttvnw.net",
    "live-video.net",
    "jtvnw.net",
    "twitch.tv",
    "twitchcdn.net",
    "cloudfront.net",
    "akamaized.net",
];

fn host_allowed(host: &str) -> bool {
    ALLOWED_HOSTS
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

fn error(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_TYPE, "text/plain")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

/// Macht alle URIs einer m3u8-Playlist absolut (relativ zur Playlist-URL).
fn rewrite_playlist(text: &str, base: &url::Url) -> String {
    let abs = |u: &str| base.join(u).map(|j| j.to_string()).unwrap_or_else(|_| u.to_string());
    let mut out = String::with_capacity(text.len() + 256);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }
        if !trimmed.starts_with('#') {
            out.push_str(&abs(trimmed));
        } else if let Some(start) = trimmed.find("URI=\"") {
            let s = start + 5;
            if let Some(len) = trimmed[s..].find('"') {
                out.push_str(&trimmed[..s]);
                out.push_str(&abs(&trimmed[s..s + len]));
                out.push_str(&trimmed[s + len..]);
            } else {
                out.push_str(trimmed);
            }
        } else {
            out.push_str(trimmed);
        }
        out.push('\n');
    }
    out
}

pub async fn handle(client: reqwest::Client, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = request.uri().path().trim_start_matches('/');
    let decoded = percent_decode_str(path).decode_utf8_lossy().to_string();

    let target = match url::Url::parse(&decoded) {
        Ok(u) if u.scheme() == "https" => u,
        _ => return error(StatusCode::BAD_REQUEST, "invalid url"),
    };
    if !target.host_str().map(host_allowed).unwrap_or(false) {
        return error(StatusCode::FORBIDDEN, "host not allowed");
    }

    let res = match client.get(target.clone()).send().await {
        Ok(r) => r,
        Err(e) => return error(StatusCode::BAD_GATEWAY, &e.to_string()),
    };

    let status = res.status();
    let final_url = res.url().clone();
    let content_type = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = match res.bytes().await {
        Ok(b) => b,
        Err(e) => return error(StatusCode::BAD_GATEWAY, &e.to_string()),
    };

    let is_playlist = content_type.contains("mpegurl")
        || final_url.path().ends_with(".m3u8")
        || bytes.starts_with(b"#EXTM3U");

    let body = if is_playlist && status.is_success() {
        rewrite_playlist(&String::from_utf8_lossy(&bytes), &final_url).into_bytes()
    } else {
        bytes.to_vec()
    };

    Response::builder()
        .status(status.as_u16())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "response build failed"))
}
