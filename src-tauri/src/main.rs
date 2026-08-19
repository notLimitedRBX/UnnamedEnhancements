#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg(target_os = "windows")]
mod dpi;
#[cfg(target_os = "windows")]
mod remap;

#[derive(Default)]
struct TrayState {
    minimize_to_tray: AtomicBool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MouseDevice {
    id: String,
    name: String,
    manufacturer: Option<String>,
    vid: Option<String>,
    pid: Option<String>,
    connection: String,
    connected: bool,
}

#[tauri::command]
fn detect_mice(show_hidden: bool) -> Result<Vec<MouseDevice>, String> {
    #[cfg(target_os = "windows")]
    {
        let mice = windows_mouse_detection::detect()?;
        Ok(mice.into_iter().filter(|mouse| show_hidden || is_relevant_mouse(mouse)).collect())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = show_hidden;
        Err("Mouse detection is currently available on Windows only.".to_string())
    }
}

#[tauri::command]
fn inspect_dpi_hardware() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        serde_json::to_value(dpi::inspect_dpi_hardware()?)
            .map_err(|error| format!("Could not serialise HID diagnostics: {error}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("DPI diagnostics are currently available on Windows only.".to_string())
    }
}

#[tauri::command]
fn set_dpi(dpi: u16) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    { dpi::set_dpi(dpi) }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dpi;
        Err("DPI control is currently available on Windows only.".to_string())
    }
}

#[tauri::command]
fn set_minimize_to_tray(enabled: bool, state: tauri::State<'_, TrayState>) {
    state.minimize_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn test_button_action(action: String, target: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        remap::run_action(&action, target.as_deref())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (action, target);
        Err("Button actions are currently available on Windows only.".to_string())
    }
}

#[tauri::command]
fn apply_button_mappings(mappings: std::collections::HashMap<String, remap::ButtonBinding>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        remap::set_mappings(mappings);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = mappings;
        Err("Button remapping is currently available on Windows only.".to_string())
    }
}
fn is_relevant_mouse(mouse: &MouseDevice) -> bool {
    const GAMING_BRANDS: &[&str] = &[
        "attack shark", "logitech", "razer", "steelseries", "corsair", "glorious",
        "pulsar", "endgame gear", "zowie", "benq", "finalmouse", "lamzu", "darmoshark",
        "vxe", "redragon", "hyperx", "roccat", "asus", "cooler master",
    ];
    const HIDDEN_DEVICE_TERMS: &[&str] = &[
        "hid-compliant mouse", "microsoft input device", "touchpad", "trackpad",
        "remote desktop", "virtual", "vmware", "vbox",
    ];
    let text = format!("{} {}", mouse.name, mouse.manufacturer.as_deref().unwrap_or_default()).to_ascii_lowercase();
    if HIDDEN_DEVICE_TERMS.iter().any(|term| text.contains(term)) { return false; }
    if GAMING_BRANDS.iter().any(|brand| text.contains(brand)) { return true; }
    mouse.vid.is_some() && mouse.manufacturer.is_some() && !text.contains("microsoft") && !text.contains("unknown")
}

fn apply_known_mouse_identity(mouse: &mut MouseDevice) {
    if mouse.vid.as_deref() == Some("0x3151")
        && matches!(mouse.pid.as_deref(), Some("0x5031") | Some("0x5032"))
    {
        mouse.name = "Attack Shark X1".to_string();
        mouse.manufacturer = Some("Attack Shark".to_string());
    } else if mouse.vid.as_deref() == Some("0x046d")
        && matches!(mouse.pid.as_deref(), Some("0xc53f") | Some("0x4074"))
    {
        // The G305 is exposed through its LIGHTSPEED receiver. The receiver
        // commonly identifies as C53F, while the paired mouse is 4074.
        mouse.name = "Logitech G305 LIGHTSPEED".to_string();
        mouse.manufacturer = Some("Logitech G".to_string());
        mouse.connection = "LIGHTSPEED wireless".to_string();
    }
}

#[cfg(target_os = "windows")]
mod windows_mouse_detection {
    use super::{apply_known_mouse_identity, MouseDevice};
    use std::mem::size_of;
    use windows::{
        core::PCWSTR,
        Win32::Devices::DeviceAndDriverInstallation::{
            SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW,
            SetupDiGetDeviceInstanceIdW, SetupDiGetDeviceRegistryPropertyW, DIGCF_PRESENT,
            GUID_DEVCLASS_MOUSE, HDEVINFO, SETUP_DI_REGISTRY_PROPERTY, SP_DEVINFO_DATA,
            SPDRP_DEVICEDESC, SPDRP_FRIENDLYNAME, SPDRP_HARDWAREID, SPDRP_MFG,
        },
    };

    pub fn detect() -> Result<Vec<MouseDevice>, String> {
        let device_info_set = unsafe { SetupDiGetClassDevsW(Some(&GUID_DEVCLASS_MOUSE), PCWSTR::null(), None, DIGCF_PRESENT) }
            .map_err(|error| format!("Windows could not enumerate mouse devices: {error}"))?;
        let mut mice = Vec::new();
        let mut index = 0;
        loop {
            let mut device_info = SP_DEVINFO_DATA { cbSize: size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
            if unsafe { SetupDiEnumDeviceInfo(device_info_set, index, &mut device_info) }.is_err() { break; }
            index += 1;
            let instance_id = device_instance_id(device_info_set, &device_info);
            let hardware_id = registry_property(device_info_set, &device_info, SPDRP_HARDWAREID).unwrap_or_else(|| instance_id.clone());
            let name = registry_property(device_info_set, &device_info, SPDRP_FRIENDLYNAME)
                .or_else(|| registry_property(device_info_set, &device_info, SPDRP_DEVICEDESC))
                .unwrap_or_else(|| "Unknown mouse".to_string());
            let manufacturer = registry_property(device_info_set, &device_info, SPDRP_MFG).filter(|value| !value.trim().is_empty());
            let id_source = format!("{hardware_id} {instance_id}");
            let mut mouse = MouseDevice {
                id: instance_id,
                name,
                manufacturer,
                vid: usb_identifier(&id_source, "VID_"),
                pid: usb_identifier(&id_source, "PID_"),
                connection: connection_type(&id_source).to_string(),
                connected: true,
            };
            apply_known_mouse_identity(&mut mouse);
            mice.push(mouse);
        }
        let _ = unsafe { SetupDiDestroyDeviceInfoList(device_info_set) };
        mice.sort_by(|left, right| left.name.cmp(&right.name));
        mice.dedup_by(|left, right| left.id == right.id);
        Ok(mice)
    }

    fn registry_property(device_info_set: HDEVINFO, device_info: &SP_DEVINFO_DATA, property: SETUP_DI_REGISTRY_PROPERTY) -> Option<String> {
        let mut required_size = 0;
        let _ = unsafe { SetupDiGetDeviceRegistryPropertyW(device_info_set, device_info, property, None, None, Some(&mut required_size)) };
        if required_size == 0 { return None; }
        let mut buffer = vec![0_u8; required_size as usize];
        unsafe { SetupDiGetDeviceRegistryPropertyW(device_info_set, device_info, property, None, Some(buffer.as_mut_slice()), None).ok()?; }
        let characters = buffer.chunks_exact(2).map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]])).take_while(|character| *character != 0).collect::<Vec<_>>();
        let value = String::from_utf16_lossy(&characters).trim().to_string();
        (!value.is_empty()).then_some(value)
    }

    fn device_instance_id(device_info_set: HDEVINFO, device_info: &SP_DEVINFO_DATA) -> String {
        let mut required_size = 0;
        let _ = unsafe { SetupDiGetDeviceInstanceIdW(device_info_set, device_info, None, Some(&mut required_size)) };
        if required_size == 0 { return "unknown-device".to_string(); }
        let mut buffer = vec![0_u16; required_size as usize];
        if unsafe { SetupDiGetDeviceInstanceIdW(device_info_set, device_info, Some(buffer.as_mut_slice()), None) }.is_err() { return "unknown-device".to_string(); }
        String::from_utf16_lossy(&buffer.into_iter().take_while(|character| *character != 0).collect::<Vec<_>>())
    }

    fn usb_identifier(value: &str, key: &str) -> Option<String> {
        let value = value.to_ascii_uppercase();
        let start = value.find(key)? + key.len();
        let identifier = value[start..].chars().take_while(|character| character.is_ascii_hexdigit()).take(4).collect::<String>();
        (identifier.len() == 4).then(|| format!("0x{identifier}"))
    }

    fn connection_type(value: &str) -> &'static str {
        let value = value.to_ascii_uppercase();
        if value.contains("BTH") || value.contains("BLUETOOTH") { "Bluetooth" }
        else if value.contains("USB") || value.contains("VID_") { "USB" }
        else { "Wired" }
    }
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    percent: u8,
    status: String,
}

fn emit_download_progress(app: &tauri::AppHandle, percent: u8, status: impl Into<String>) {
    let _ = app.emit("download-progress", DownloadProgress { percent, status: status.into() });
}

fn finish_download_and_launch(
    app: &tauri::AppHandle,
    destination: &PathBuf,
    started_at: Instant,
) -> Result<(), String> {
    const MINIMUM_DOWNLOAD_SCREEN: Duration = Duration::from_secs(8);

    while started_at.elapsed() < MINIMUM_DOWNLOAD_SCREEN {
        let elapsed_ms = started_at.elapsed().as_millis().min(8_000) as u64;
        let percent = 90 + ((elapsed_ms * 9) / 8_000) as u8;
        emit_download_progress(app, percent, "Preparing Unnamed Enhancements...");
        std::thread::sleep(Duration::from_millis(250));
    }

    emit_download_progress(app, 100, "Launching Unnamed Enhancements...");
    Command::new(destination)
        .spawn()
        .map_err(|error| format!("The app downloaded but could not be launched: {error}"))?;
    Ok(())
}

#[tauri::command]
fn download_latest_app(app: tauri::AppHandle) -> Result<(), String> {
    let started_at = Instant::now();
    emit_download_progress(&app, 0, "Checking for the latest version...");

    let client = reqwest::blocking::Client::builder()
        .user_agent("UnnamedEnhancementsDownloader/0.1")
        .build()
        .map_err(|error| format!("Could not create download client: {error}"))?;
    let release: GithubRelease = client
        .get("https://api.github.com/repos/notLimitedRBX/UnnamedEnhancements/releases/latest")
        .send()
        .map_err(|error| format!("Could not check for a published app release: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Could not check for a published app release: {error}"))?
        .json()
        .map_err(|error| format!("Could not read the published app release: {error}"))?;

    let GithubRelease { tag_name: release_tag, assets } = release;
    let asset = assets
        .into_iter()
        .find(|asset| asset.name == "UnnamedEnhancements.exe")
        .ok_or_else(|| "The latest release does not contain UnnamedEnhancements.exe.".to_string())?;

    let app_data = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "Windows Local AppData could not be found.".to_string())?;
    let install_directory = PathBuf::from(app_data).join("UnnamedEnhancements");
    fs::create_dir_all(&install_directory)
        .map_err(|error| format!("Could not create the app folder: {error}"))?;
    let destination = install_directory.join("UnnamedEnhancements.exe");
    let temporary_destination = install_directory.join("UnnamedEnhancements.download");
    let version_marker = install_directory.join("version.txt");
    let installed_version_matches = fs::read_to_string(&version_marker)
        .map(|version| version.trim() == release_tag)
        .unwrap_or(false);
    let installed_file_matches = fs::metadata(&destination)
        .map(|metadata| metadata.len() == asset.size)
        .unwrap_or(false);

    if installed_version_matches && installed_file_matches {
        emit_download_progress(&app, 90, "Already up to date. Preparing...");
        return finish_download_and_launch(&app, &destination, started_at);
    }

    let mut response = client
        .get(&asset.browser_download_url)
        .send()
        .map_err(|error| format!("Could not start the app download: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Could not start the app download: {error}"))?;
    let total_bytes = response.content_length().filter(|size| *size > 0).unwrap_or(asset.size);
    let mut file = File::create(&temporary_destination)
        .map_err(|error| format!("Could not create the app download: {error}"))?;
    let mut downloaded_bytes = 0_u64;
    let mut last_percent = 0_u8;
    let mut buffer = [0_u8; 256 * 1024];

    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("Could not download the app: {error}"))?;
        if read == 0 { break; }
        file.write_all(&buffer[..read])
            .map_err(|error| format!("Could not save the app download: {error}"))?;
        downloaded_bytes += read as u64;
        let percent = ((downloaded_bytes.saturating_mul(100) / total_bytes).min(100)) as u8;
        if percent > last_percent {
            last_percent = percent;
            emit_download_progress(&app, percent, format!("Downloading... {percent}%"));
        }
    }
    file.flush().map_err(|error| format!("Could not finish the app download: {error}"))?;
    drop(file);

    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("Close Unnamed Enhancements before updating it: {error}"))?;
    }
    fs::rename(&temporary_destination, &destination)
        .map_err(|error| format!("Could not finish the app download: {error}"))?;
    let _ = fs::write(&version_marker, &release_tag);

    finish_download_and_launch(&app, &destination, started_at)
}

fn main() {
    #[cfg(target_os = "windows")]
    remap::start();

    tauri::Builder::default()
        .manage(TrayState { minimize_to_tray: AtomicBool::new(true) })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![detect_mice, inspect_dpi_hardware, set_dpi, set_minimize_to_tray, test_button_action, apply_button_mappings, download_latest_app])
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let script = r#"(() => {
                    const key = 'unnamed-minimise-to-tray';
                    const install = () => {
                        const row = [...document.querySelectorAll('label.toggle-row')].find((el) => (el.textContent || '').includes('Minimise to tray'));
                        const input = row?.querySelector('input[type="checkbox"]');
                        if (!input || input.dataset.trayBound === '1') return;
                        input.dataset.trayBound = '1';
                        const saved = localStorage.getItem(key);
                        if (saved !== null) input.checked = saved === 'true';
                        const sync = () => {
                            localStorage.setItem(key, String(input.checked));
                            window.__TAURI_INTERNALS__?.invoke('set_minimize_to_tray', { enabled: input.checked });
                        };
                        input.addEventListener('change', sync);
                        sync();
                    };
                    install();
                    new MutationObserver(install).observe(document.body, { childList: true, subtree: true });
                })();"#;
                let _ = window.eval(script);
            }
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            TrayIconEvent::Click { button: MouseButton::Right, button_state: MouseButtonState::Up, .. } => {
                tray.app_handle().exit(0);
            }
            _ => {}
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<TrayState>();
                if state.minimize_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let mut builder = TrayIconBuilder::new()
                .show_menu_on_left_click(false)
                .tooltip("Unnamed Desktop App");
            if let Some(icon) = app.default_window_icon().cloned() {
                builder = builder.icon(icon);
            }
            builder.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
