use serde::Deserialize;
use std::{
    collections::HashMap,
    process::Command,
    sync::{OnceLock, RwLock},
    thread,
};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HHOOK,
        MSLLHOOKSTRUCT, MSG, WH_MOUSE_LL, WM_XBUTTONDOWN, WM_XBUTTONUP,
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
