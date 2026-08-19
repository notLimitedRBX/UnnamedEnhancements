use serde::Deserialize;
use std::{
    collections::HashMap,
    mem::size_of,
    process::Command,
    sync::{OnceLock, RwLock},
    thread,
};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    UI::{
        Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY},
        WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HHOOK,
        MSLLHOOKSTRUCT, MSG, WH_MOUSE_LL, WM_XBUTTONDOWN, WM_XBUTTONUP,
        },
    },
};

const HC_ACTION: i32 = 0;

#[derive(Debug, Clone, Deserialize)]
pub struct ButtonBinding {
    pub action: String,
    pub target: Option<String>,
}

static MAPPINGS: OnceLock<RwLock<HashMap<String, ButtonBinding>>> = OnceLock::new();

pub fn start() {
    MAPPINGS.get_or_init(|| RwLock::new(HashMap::new()));
    thread::spawn(|| unsafe {
        let hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0) {
            Ok(hook) => hook,
            Err(_) => return,
        };
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {}
        let _ = UnhookWindowsHookEx(hook);
    });
}

pub fn set_mappings(mappings: HashMap<String, ButtonBinding>) {
    if let Some(stored) = MAPPINGS.get() {
        if let Ok(mut stored) = stored.write() {
            *stored = mappings;
        }
    }
}

pub fn run_action(action: &str, target: Option<&str>) -> Result<(), String> {
    let (program, argument) = match action {
        "Open File Explorer" => ("explorer.exe", None),
        "Open Task Manager" => ("taskmgr.exe", None),
        "Open Windows Settings" => ("explorer.exe", Some("ms-settings:")),
        "Open Email" => ("explorer.exe", Some("mailto:")),
        "Keybind" => return send_keybind(target),
        "Custom program" => {
            let target = target.map(str::trim).filter(|target| !target.is_empty())
                .ok_or_else(|| "Enter a program path before using a custom program action.".to_string())?;
            (target, None)
        }
        "Disabled" => return Ok(()),
        "Default" | "Back" | "Forward" | "DPI Up" | "DPI Down" => {
            return Err("This action is handled by the mouse itself and does not need a Windows launch action.".to_string())
        }
        _ => return Err("That button action is not supported yet.".to_string()),
    };

    let mut command = Command::new(program);
    if let Some(argument) = argument { command.arg(argument); }
    command.spawn().map_err(|error| format!("Could not start this action: {error}"))?;
    Ok(())
}

fn send_keybind(target: Option<&str>) -> Result<(), String> {
    let target = target.map(str::trim).filter(|value| !value.is_empty())
        .ok_or_else(|| "Choose a key before using a keybind action.".to_string())?;
    let parts = target.split('+').map(str::trim).filter(|part| !part.is_empty()).collect::<Vec<_>>();
    let (last, modifiers) = parts.split_last().ok_or_else(|| "Choose a key before using a keybind action.".to_string())?;
    let mut keys = Vec::new();
    for modifier in modifiers {
        let code = match modifier.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => 0x11,
            "alt" => 0x12,
            "shift" => 0x10,
            "win" | "windows" | "meta" => 0x5b,
            _ => return Err(format!("Unsupported modifier: {modifier}")),
        };
        keys.push(code);
    }
    keys.push(key_code(last).ok_or_else(|| format!("Unsupported keybind: {target}"))?);

    let mut inputs = Vec::with_capacity(keys.len() * 2);
    for code in &keys { inputs.push(key_input(*code, false)); }
    for code in keys.iter().rev() { inputs.push(key_input(*code, true)); }
    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err("Windows could not send that keybind.".to_string());
    }
    Ok(())
}

fn key_code(key: &str) -> Option<u16> {
    let key = key.trim().to_ascii_uppercase();
    if key.len() == 1 {
        let value = key.as_bytes()[0];
        return (value.is_ascii_alphanumeric()).then_some(value as u16);
    }
    match key.as_str() {
        "SPACE" => Some(0x20),
        "TAB" => Some(0x09),
        "ENTER" | "RETURN" => Some(0x0d),
        "ESC" | "ESCAPE" => Some(0x1b),
        "BACKSPACE" => Some(0x08),
        "DELETE" | "DEL" => Some(0x2e),
        "UP" => Some(0x26),
        "DOWN" => Some(0x28),
        "LEFT" => Some(0x25),
        "RIGHT" => Some(0x27),
        _ if key.starts_with('F') => key[1..].parse::<u16>().ok().filter(|value| (1..=24).contains(value)).map(|value| 0x6f + value),
        _ => None,
    }
}

fn key_input(code: u16, released: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(code),
                wScan: 0,
                dwFlags: if released { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn should_intercept(binding: &ButtonBinding) -> bool {
    !matches!(binding.action.as_str(), "Default" | "Back" | "Forward" | "DPI Up" | "DPI Down")
}

unsafe extern "system" fn mouse_hook(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if code == HC_ACTION && (w_param.0 as u32 == WM_XBUTTONDOWN || w_param.0 as u32 == WM_XBUTTONUP) {
        let data = *(l_param.0 as *const MSLLHOOKSTRUCT);
        let button = ((data.mouseData >> 16) & 0xffff) as u16;
        let button_name = match button {
            1 => Some("Button 4"),
            2 => Some("Button 5"),
            _ => None,
        };

        if let Some(button_name) = button_name {
            let binding = MAPPINGS
                .get()
                .and_then(|mappings| mappings.read().ok())
                .and_then(|mappings| mappings.get(button_name).cloned());

            if let Some(binding) = binding.filter(should_intercept) {
                if w_param.0 as u32 == WM_XBUTTONDOWN {
                    thread::spawn(move || {
                        let _ = run_action(&binding.action, binding.target.as_deref());
                    });
                }
                return LRESULT(1);
            }
        }
    }

    CallNextHookEx(None, code, w_param, l_param)
}
