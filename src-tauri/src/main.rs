#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

#[cfg(target_os = "windows")]
mod dpi;

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
fn set_dpi(dpi: u16) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    { dpi::set_dpi(dpi) }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dpi;
        Err("DPI control is currently available on Windows only.".to_string())
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
    if mouse.vid.as_deref() == Some("0x3151") && mouse.pid.as_deref() == Some("0x5031") {
        mouse.name = "Attack Shark X1".to_string();
        mouse.manufacturer = Some("Attack Shark".to_string());
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![detect_mice, set_dpi])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
