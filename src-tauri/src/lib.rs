mod geometry;

use std::time::Duration;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Must match `minWidth` / `minHeight` in tauri.conf.json (logical px).
const MIN_SIZE: (f64, f64) = (300.0, 380.0);
/// Must match the connection string used by the frontend (src/db/connection.ts).
const DB_URL: &str = "sqlite:desktodo.db";

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial schema",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch just focuses the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                geometry::restore(&window, MIN_SIZE);
                // The frontend shows the window after its first paint (no white flash).
                // Safety net: if the frontend fails to load, show the window anyway.
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                });
            }
            Ok(())
        })
        .on_window_event(geometry::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running DeskTodo");
}
