//! Window geometry persistence.
//!
//! The window is created hidden; the saved position/size is applied in Rust
//! *before* the webview shows it, so there is no visible jump on startup.
//! Geometry is tracked from native move/resize events (no JS, no React state)
//! and written once when the window closes.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, Window, WindowEvent};

const FILE_NAME: &str = "window-state.json";
/// Height (physical px) of the area that must stay reachable so the user can drag the window.
const GRAB_HEIGHT: i32 = 32;
/// Minimum visible width of the title bar for the position to be considered usable.
const MIN_VISIBLE_WIDTH: i32 = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn right(&self) -> i64 {
        self.x as i64 + self.width as i64
    }
    fn bottom(&self) -> i64 {
        self.y as i64 + self.height as i64
    }
    fn intersection_area(&self, other: &Rect) -> (i64, i64) {
        let w = self.right().min(other.right()) - (self.x.max(other.x) as i64);
        let h = self.bottom().min(other.bottom()) - (self.y.max(other.y) as i64);
        (w.max(0), h.max(0))
    }
}

/// Returns a rectangle guaranteed to be usable on the current monitor layout.
///
/// * If the title bar of `saved` is sufficiently visible on any monitor's work
///   area, the position is kept (only the size is clamped to that monitor).
/// * Otherwise the window is moved onto the monitor it overlaps most (or the
///   first/primary monitor) and clamped to fit inside it.
pub fn fit_to_monitors(saved: Rect, monitors: &[Rect], min_size: (u32, u32)) -> Rect {
    let mut r = Rect {
        width: saved.width.max(min_size.0),
        height: saved.height.max(min_size.1),
        ..saved
    };
    if monitors.is_empty() {
        return r;
    }

    let grab = Rect { x: r.x, y: r.y, width: r.width, height: GRAB_HEIGHT as u32 };
    let visible_on = monitors.iter().find(|m| {
        let (w, h) = grab.intersection_area(m);
        // The top edge must not be above the monitor, otherwise the bar is unreachable.
        w >= MIN_VISIBLE_WIDTH as i64 && h >= (GRAB_HEIGHT / 2) as i64 && r.y >= m.y
    });

    let target = match visible_on {
        Some(m) => {
            r.width = r.width.min(m.width.max(min_size.0));
            r.height = r.height.min(m.height.max(min_size.1));
            return r;
        }
        None => monitors
            .iter()
            .max_by_key(|m| {
                let (w, h) = r.intersection_area(m);
                w * h
            })
            .filter(|m| {
                let (w, h) = r.intersection_area(m);
                w * h > 0
            })
            .unwrap_or(&monitors[0]),
    };

    r.width = r.width.min(target.width).max(min_size.0.min(target.width));
    r.height = r.height.min(target.height).max(min_size.1.min(target.height));
    let max_x = target.right() - r.width as i64;
    let max_y = target.bottom() - r.height as i64;
    r.x = (r.x as i64).clamp(target.x as i64, max_x.max(target.x as i64)) as i32;
    r.y = (r.y as i64).clamp(target.y as i64, max_y.max(target.y as i64)) as i32;
    r
}

#[derive(Default)]
pub struct GeometryState(Mutex<Option<Rect>>);

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(FILE_NAME))
}

fn read_saved<R: Runtime>(app: &AppHandle<R>) -> Option<Rect> {
    let text = std::fs::read_to_string(state_path(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_saved<R: Runtime>(app: &AppHandle<R>, rect: &Rect) {
    let Some(path) = state_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let Ok(json) = serde_json::to_string(rect) else { return };
    // Write-then-rename so a crash mid-write never leaves a corrupt file.
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

fn current_rect<R: Runtime>(window: &Window<R>) -> Option<Rect> {
    if window.is_minimized().unwrap_or(true) || window.is_maximized().unwrap_or(false) {
        return None;
    }
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(Rect { x: pos.x, y: pos.y, width: size.width, height: size.height })
}

/// Applies the saved geometry (if any) to the hidden main window.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>, min_logical: (f64, f64)) {
    let app = window.app_handle();
    app.manage(GeometryState::default());
    let Some(saved) = read_saved(app) else { return };

    let scale = window.scale_factor().unwrap_or(1.0);
    let min = ((min_logical.0 * scale) as u32, (min_logical.1 * scale) as u32);
    let monitors: Vec<Rect> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let wa = m.work_area();
            Rect { x: wa.position.x, y: wa.position.y, width: wa.size.width, height: wa.size.height }
        })
        .collect();

    let fitted = fit_to_monitors(saved, &monitors, min);
    let _ = window.set_position(PhysicalPosition::new(fitted.x, fitted.y));
    let _ = window.set_size(PhysicalSize::new(fitted.width, fitted.height));
    if let Some(state) = app.try_state::<GeometryState>() {
        *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(fitted);
    }
}

/// Native window event hook: cheap bookkeeping on move/resize, single write on close.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let Some(state) = window.try_state::<GeometryState>() else { return };
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if let Some(rect) = current_rect(window) {
                *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(rect);
            }
        }
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            let rect = current_rect(window).or(*state.0.lock().unwrap_or_else(|e| e.into_inner()));
            if let Some(rect) = rect {
                write_saved(window.app_handle(), &rect);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: (u32, u32) = (300, 380);
    const PRIMARY: Rect = Rect { x: 0, y: 0, width: 1920, height: 1040 };
    const RIGHT: Rect = Rect { x: 1920, y: 0, width: 2560, height: 1400 };
    const LEFT_HIDPI: Rect = Rect { x: -2880, y: -200, width: 2880, height: 1760 };

    #[test]
    fn keeps_visible_position() {
        let r = Rect { x: 1500, y: 100, width: 360, height: 520 };
        assert_eq!(fit_to_monitors(r, &[PRIMARY], MIN), r);
    }

    #[test]
    fn keeps_position_on_secondary_and_negative_monitors() {
        let on_right = Rect { x: 3000, y: 300, width: 360, height: 520 };
        assert_eq!(fit_to_monitors(on_right, &[PRIMARY, RIGHT], MIN), on_right);
        let on_left = Rect { x: -1000, y: -100, width: 360, height: 520 };
        assert_eq!(fit_to_monitors(on_left, &[PRIMARY, LEFT_HIDPI], MIN), on_left);
    }

    #[test]
    fn moves_window_back_when_monitor_disconnected() {
        // Saved on the right monitor which is no longer attached.
        let r = Rect { x: 3000, y: 300, width: 360, height: 520 };
        let fitted = fit_to_monitors(r, &[PRIMARY], MIN);
        assert!(fitted.x >= 0 && fitted.right() <= 1920);
        assert!(fitted.y >= 0 && fitted.bottom() <= 1040);
        assert_eq!((fitted.width, fitted.height), (360, 520));
    }

    #[test]
    fn recovers_title_bar_above_screen() {
        let r = Rect { x: 100, y: -400, width: 360, height: 520 };
        let fitted = fit_to_monitors(r, &[PRIMARY], MIN);
        assert_eq!(fitted.y, 0);
        assert_eq!(fitted.x, 100);
    }

    #[test]
    fn recovers_minimized_sentinel_position() {
        // Windows reports (-32000, -32000) for minimized windows.
        let r = Rect { x: -32000, y: -32000, width: 360, height: 520 };
        let fitted = fit_to_monitors(r, &[PRIMARY, RIGHT], MIN);
        assert_eq!((fitted.x, fitted.y), (0, 0));
    }

    #[test]
    fn mostly_offscreen_moves_into_overlapping_monitor() {
        // Only 40px of the title bar visible on the right edge of the primary monitor.
        let r = Rect { x: 1880, y: 200, width: 360, height: 520 };
        let fitted = fit_to_monitors(r, &[PRIMARY], MIN);
        assert_eq!(fitted.right(), 1920);
        assert_eq!(fitted.y, 200);
    }

    #[test]
    fn clamps_oversized_window_and_enforces_minimum() {
        let huge = Rect { x: 0, y: 0, width: 5000, height: 5000 };
        let fitted = fit_to_monitors(huge, &[PRIMARY], MIN);
        assert_eq!((fitted.width, fitted.height), (1920, 1040));
        let tiny = Rect { x: 10, y: 10, width: 10, height: 10 };
        let fitted = fit_to_monitors(tiny, &[PRIMARY], MIN);
        assert_eq!((fitted.width, fitted.height), MIN);
    }

    #[test]
    fn no_monitors_returns_saved() {
        let r = Rect { x: 5, y: 5, width: 360, height: 520 };
        assert_eq!(fit_to_monitors(r, &[], MIN), r);
    }
}
