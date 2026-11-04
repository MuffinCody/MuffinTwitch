mod auth;
mod drops;
mod points;
mod proxy;
mod stream;

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pub http: reqwest::Client,
    pub auth: Mutex<auth::AuthData>,
    pub auth_path: PathBuf,
}

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Hängt eine Zeile an `nativ.log` im App-Konfigurationsordner an.
pub fn log_line(msg: &str) {
    let Some(path) = LOG_PATH.get() else { return };
    // Log klein halten
    if std::fs::metadata(path).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "[{ts}] {msg}");
    }
}

/// Fehler aus dem Frontend protokollieren.
#[tauri::command]
fn log_error(message: String) {
    log_line(&format!("frontend: {}", message.chars().take(2000).collect::<String>()));
}

/// Stürzt der Renderprozess des WebViews ab, wird die Seite neu geladen,
/// statt ein leeres/eingefrorenes Fenster zu hinterlassen.
#[cfg(windows)]
fn install_crash_recovery(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::ProcessFailedEventHandler;

    let _ = window.with_webview(|wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let handler = ProcessFailedEventHandler::create(Box::new(|sender, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            if let Some(a) = &args {
                let _ = a.ProcessFailedKind(&mut kind);
            }
            log_line(&format!("WebView2-Prozess fehlgeschlagen: {:?}", kind.0));
            let reload = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;
            if reload {
                if let Some(s) = sender {
                    let _ = s.Reload();
                }
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_ProcessFailed(&handler, &mut token);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        log_line(&format!("PANIC: {info}"));
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir).ok();
            let _ = LOG_PATH.set(dir.join("nativ.log"));
            let auth_path = dir.join("auth.json");
            let auth = auth::AuthData::load(&auth_path);
            let http = reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .gzip(true)
                .pool_max_idle_per_host(16)
                .connect_timeout(std::time::Duration::from_secs(10))
                .timeout(std::time::Duration::from_secs(30))
                .build()?;
            app.manage(AppState {
                http,
                auth: Mutex::new(auth),
                auth_path,
            });

            #[cfg(windows)]
            if let Some(w) = app.get_webview_window("main") {
                install_crash_recovery(&w);
            }
            Ok(())
        })
        // Lokaler Proxy für HLS-Playlists/-Segmente (umgeht CORS im WebView)
        .register_asynchronous_uri_scheme_protocol("twproxy", |ctx, request, responder| {
            let client = ctx.app_handle().state::<AppState>().http.clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(proxy::handle(client, request).await);
            });
        })
        .invoke_handler(tauri::generate_handler![
            log_error,
            stream::get_stream_url,
            points::channel_points,
            points::claim_points,
            drops::drops_inventory,
            drops::drops_campaigns,
            drops::claim_drop,
            points::points_menu,
            points::redeem_reward,
            auth::auth_get,
            auth::auth_web_login,
            auth::auth_set_client_id,
            auth::auth_start,
            auth::auth_poll,
            auth::auth_logout,
            auth::auth_chat_credentials,
            auth::helix,
            auth::helix_post,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Anwendung");
}
