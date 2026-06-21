use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
struct DirEntryInfo {
    name: String,
    is_dir: bool,
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

// Intentionally never returns Err: this mirrors the createFs().exists() contract
// (src/fsAccess.js) which returns false on ANY error. Callers guard reads with
// `!(await fs.exists(...))` (e.g. src/assets.js) — making this throw would break
// preview rendering and uniqueName(). Do not "fix" it to use fs::try_exists.
#[tauri::command]
fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir,
        });
    }
    Ok(entries)
}

#[cfg(windows)]
fn show_fatal_error(title: &str, message: &str) {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: isize, lptext: *const u16, lpcaption: *const u16, utype: u32) -> i32;
    }
    let wide = |s: &str| -> Vec<u16> { OsStr::new(s).encode_wide().chain(once(0)).collect() };
    let t = wide(title);
    let m = wide(message);
    unsafe { MessageBoxW(0, m.as_ptr(), t.as_ptr(), 0x10); } // MB_OK | MB_ICONERROR
}

#[cfg(not(windows))]
fn show_fatal_error(_title: &str, message: &str) {
    eprintln!("{}", message);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            read_bytes,
            write_bytes,
            path_exists,
            list_dir,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        let detail = e.to_string();
        if detail.to_lowercase().contains("webview") {
            show_fatal_error(
                "HTML Site Editor \u{2014} Missing Component",
                "HTML Site Editor requires the Microsoft WebView2 Runtime, which was not found on this computer.\
\n\nTo fix this:\
\n 1. Go to: https://developer.microsoft.com/microsoft-edge/webview2/\
\n 2. Download and run the \"Evergreen Standalone Installer\"\
\n 3. Re-launch HTML Site Editor\
\n\nNote: WebView2 is pre-installed on Windows 11 and most up-to-date Windows 10 systems.",
            );
        } else {
            show_fatal_error(
                "HTML Site Editor \u{2014} Startup Error",
                &format!("HTML Site Editor failed to start.\n\n{detail}"),
            );
        }
        std::process::exit(1);
    }
}
