import { invoke } from "@tauri-apps/api/core";
import { Bot, Gauge, Gamepad2, Keyboard, Mouse, Palette, Play, Plus, RefreshCw, SendHorizontal, Settings, SlidersHorizontal, BookOpen, Trash2, Upload, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MouseDevice = { id: string; name: string; manufacturer: string | null; vid: string | null; pid: string | null; connection: string; connected: boolean };
type Tab = "overview" | "buttons" | "performance" | "profiles" | "help" | "assistant" | "settings";
type BackgroundMode = "default" | "solid" | "gradient" | "image";
type ImageFit = "cover" | "contain" | "stretch";
type GlassMode = "regular" | "clear";
type LocalMessage = { id: string; role: "user" | "assistant"; content: string };

const tabs: { id: Tab; label: string; icon: typeof Mouse }[] = [
  { id: "overview", label: "Overview", icon: Mouse }, { id: "buttons", label: "Buttons", icon: SlidersHorizontal },
  { id: "performance", label: "Performance", icon: Gauge }, { id: "profiles", label: "Profiles", icon: Gamepad2 }, { id: "help", label: "Help", icon: BookOpen }, { id: "assistant", label: "Local AI", icon: Bot }, { id: "settings", label: "Settings", icon: Settings },
];
type ButtonAction = "Default" | "Keybind" | "Open File Explorer" | "Open Task Manager" | "Open Windows Settings" | "Open Email" | "Back" | "Forward" | "DPI Up" | "DPI Down" | "Custom program" | "Disabled";
type ButtonBinding = { action: ButtonAction; target?: string };
type Profile = { id: string; name: string; dpi: number; polling: string; buttons: Record<string, ButtonBinding> };

const buttonNames = ["Button 1", "Button 2", "Button 3", "Button 4", "Button 5"];
const actions: ButtonAction[] = ["Default", "Keybind", "Open File Explorer", "Open Task Manager", "Open Windows Settings", "Open Email", "Back", "Forward", "DPI Up", "DPI Down", "Custom program", "Disabled"];
const keybindPresets = ["F", "G", "Space", "Tab", "Ctrl+F", "Alt+Tab", "Ctrl+Shift+S"];
const defaultButtons: Record<string, ButtonBinding> = {
  "Button 1": { action: "Default" }, "Button 2": { action: "Default" }, "Button 3": { action: "Default" },
  "Button 4": { action: "Back" }, "Button 5": { action: "Forward" },
};
const dpiPresets = [400, 800, 1600, 3200, 6400, 12800];
const mouseHotspots = [
  { button: "Button 1", label: "Left click", className: "mouse-zone left-click" },
  { button: "Button 2", label: "Right click", className: "mouse-zone right-click" },
  { button: "Button 3", label: "Wheel click", className: "mouse-zone wheel-click" },
  { button: "Button 4", label: "Side 1", className: "mouse-zone side-one" },
  { button: "Button 5", label: "Side 2", className: "mouse-zone side-two" },
  { button: "Button 6", label: "DPI cycle", className: "mouse-zone dpi-cycle" },
];
const cloneButtons = (buttons = defaultButtons) => Object.fromEntries(buttonNames.map(button => [button, { ...(buttons[button] || { action: "Default" }) }]));
const makeProfile = (name: string, source?: Profile): Profile => ({
  id: crypto.randomUUID(), name, dpi: source?.dpi ?? 800, polling: source?.polling ?? "1000 Hz", buttons: cloneButtons(source?.buttons),
});
const loadProfiles = (): Profile[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem("unnamed-profiles") || "[]") as Profile[];
    if (Array.isArray(parsed) && parsed.length) return parsed.map(profile => ({ ...profile, buttons: cloneButtons(profile.buttons) }));
  } catch { /* Use safe defaults. */ }
  return [makeProfile("Default"), makeProfile("Gaming"), makeProfile("FPS")];
};

const backgroundStore = "unnamed-appearance";
const backgroundKey = "current-background";
const openBackgroundStore = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(backgroundStore, 1);
  request.onupgradeneeded = () => request.result.createObjectStore("images");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const readBackground = async () => {
  const db = await openBackgroundStore();
  return new Promise<string>((resolve, reject) => {
    const request = db.transaction("images", "readonly").objectStore("images").get(backgroundKey);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : "");
    request.onerror = () => reject(request.error);
  });
};
const writeBackground = async (image: string) => {
  const db = await openBackgroundStore();
  await new Promise<void>((resolve, reject) => {
    const store = db.transaction("images", "readwrite").objectStore("images");
    const request = image ? store.put(image, backgroundKey) : store.delete(backgroundKey);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
const prepareBackground = async (file: File) => {
  const original = await readAsDataUrl(file);
  // Canvas would flatten an animated GIF to a single frame, so retain it intact.
  if (file.type.toLowerCase() === "image/gif") return original;
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not read that image.")); image.src = original; });
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (longestSide >= 2560) return original;
  const scale = 2560 / longestSide;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) return original;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.94);
};

function hex(value: string, fallback: string) {
  const clean = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean.toUpperCase()}`;
  if (/^[0-9a-f]{3}$/i.test(clean)) return `#${clean.split("").map(c => c + c).join("").toUpperCase()}`;
  return fallback;
}
function HexColor({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value.slice(1));
  useEffect(() => setText(value.slice(1)), [value]);
  const commit = () => { const v = hex(text, value); setText(v.slice(1)); onChange(v); };
  return <div className="hex-color-control"><span>{label}</span><div className="hex-color-input"><input type="color" value={value} onChange={e => onChange(e.target.value.toUpperCase())} /><b>#</b><input value={text} maxLength={6} onChange={e => setText(e.target.value.replace(/[^0-9a-f]/gi, "").slice(0, 6))} onBlur={commit} onKeyDown={e => e.key === "Enter" && commit()} /></div></div>;
}

function KeybindInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const display = value || "Press a key combination";
  return <input className="keybind-input" aria-label="Custom keybind" value={display} onFocus={event => { if (!value) event.currentTarget.value = ""; }} onChange={() => undefined} onKeyDown={event => {
    event.preventDefault();
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const parts = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Win", key].filter(Boolean);
    onChange(parts.join("+"));
  }} onBlur={event => { event.currentTarget.value = display; }} />;
}

function DpiInput({ value, onApply, compact = false, minimum = 50, maximum = 40000 }: { value: number; onApply: (value: number) => void; compact?: boolean; minimum?: number; maximum?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const parsed = Number(text.replace(/[^0-9]/g, ""));
    const dpi = Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed / 50) * 50)) : value;
    setText(String(dpi));
    if (dpi !== value) onApply(dpi);
  };
  return <div className={compact ? "dpi-input compact" : "dpi-input"}><input aria-label="DPI value" value={text} inputMode="numeric" onChange={event => setText(event.target.value.replace(/[^0-9]/g, ""))} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.currentTarget.blur(); } }}/><span>DPI</span></div>;
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles);
  const [profile, setProfile] = useState(() => localStorage.getItem("unnamed-active-profile") || "");
  const [newProfileName, setNewProfileName] = useState("");
  const [selectedButton, setSelectedButton] = useState("Button 4");
  const [tab, setTab] = useState<Tab>("overview");
  const [mice, setMice] = useState<MouseDevice[]>([]);
  const [showOtherDevices, setShowOtherDevices] = useState(false);
  const [loading, setLoading] = useState(true);
  const [localQuestion, setLocalQuestion] = useState("");
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dpi, setDpi] = useState(800);
  const [dpiDiagnostics, setDpiDiagnostics] = useState<string | null>(null);
  const [polling, setPolling] = useState("1000 Hz");
  const [textScale, setTextScale] = useState(() => Number(localStorage.getItem("unnamed-text-scale") || 100));
  const dpiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeProfile = profiles.find(candidate => candidate.id === profile) ?? profiles[0];
  const buttons = activeProfile?.buttons ?? defaultButtons;

  const [bgMode, setBgMode] = useState<BackgroundMode>(() => (localStorage.getItem("unnamed-bg-mode") as BackgroundMode) || "default");
  const [bgColor, setBgColor] = useState(() => localStorage.getItem("unnamed-bg-color") || "#101112");
  const [gradA, setGradA] = useState(() => localStorage.getItem("unnamed-bg-gradient-from") || "#101112");
  const [gradB, setGradB] = useState(() => localStorage.getItem("unnamed-bg-gradient-to") || "#202124");
  const [bgImage, setBgImage] = useState("");
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [fit, setFit] = useState<ImageFit>(() => (localStorage.getItem("unnamed-bg-fit") as ImageFit) || "cover");
  const [bgFocus, setBgFocus] = useState(() => localStorage.getItem("unnamed-bg-focus") || "center");
  const [bgOpacity, setBgOpacity] = useState(() => Number(localStorage.getItem("unnamed-bg-opacity") || 100));
  const [bgBlur, setBgBlur] = useState(() => Number(localStorage.getItem("unnamed-bg-blur") || 0));
  const [bgSaturation, setBgSaturation] = useState(() => Number(localStorage.getItem("unnamed-bg-saturation") || 100));
  const [uiScale, setUiScale] = useState(() => Number(localStorage.getItem("unnamed-ui-scale") || 100));
  const [bootProgress, setBootProgress] = useState(0);
  const [showBoot, setShowBoot] = useState(() => localStorage.getItem("unnamed-welcome-seen") !== "true");
  const [testerOpen, setTesterOpen] = useState(false);
  const [testedInputs, setTestedInputs] = useState<string[]>([]);
  const [testerStatus, setTesterStatus] = useState("Waiting for an input");

  const [glassMode, setGlassMode] = useState<GlassMode>(() => (localStorage.getItem("unnamed-glass-mode") as GlassMode) || "regular");
  const [glassOpacity, setGlassOpacity] = useState(() => Number(localStorage.getItem("unnamed-glass-opacity") || 64));
  const [glassBlur, setGlassBlur] = useState(() => Number(localStorage.getItem("unnamed-glass-blur") || 22));
  const [glassTint, setGlassTint] = useState(() => localStorage.getItem("unnamed-glass-tint") || "#15171B");
  const [glassBorder, setGlassBorder] = useState(() => Number(localStorage.getItem("unnamed-glass-border") || 42));
  const [glassRadius, setGlassRadius] = useState(() => Number(localStorage.getItem("unnamed-glass-radius") || 16));

  useEffect(() => {
    const started = Date.now();
    let hideTimer: number | undefined;
    const timer = window.setInterval(() => {
      const progress = Math.min(100, Math.round(((Date.now() - started) / 8000) * 100));
      setBootProgress(progress);
      if (progress === 100) {
        window.clearInterval(timer);
        hideTimer = window.setTimeout(() => { localStorage.setItem("unnamed-welcome-seen", "true"); setShowBoot(false); }, 260);
      }
    }, 80);
    return () => { window.clearInterval(timer); if (hideTimer) window.clearTimeout(hideTimer); };
  }, []);

  useEffect(() => { localStorage.setItem("unnamed-bg-mode", bgMode); localStorage.setItem("unnamed-bg-color", bgColor); localStorage.setItem("unnamed-bg-gradient-from", gradA); localStorage.setItem("unnamed-bg-gradient-to", gradB); localStorage.setItem("unnamed-bg-fit", fit); localStorage.setItem("unnamed-bg-focus", bgFocus); localStorage.setItem("unnamed-bg-opacity", String(bgOpacity)); localStorage.setItem("unnamed-bg-blur", String(bgBlur)); localStorage.setItem("unnamed-bg-saturation", String(bgSaturation)); localStorage.setItem("unnamed-ui-scale", String(uiScale)); localStorage.setItem("unnamed-glass-mode", glassMode); localStorage.setItem("unnamed-glass-opacity", String(glassOpacity)); localStorage.setItem("unnamed-glass-blur", String(glassBlur)); localStorage.setItem("unnamed-glass-tint", glassTint); localStorage.setItem("unnamed-glass-border", String(glassBorder)); localStorage.setItem("unnamed-glass-radius", String(glassRadius)); localStorage.setItem("unnamed-text-scale", String(textScale)); }, [bgMode,bgColor,gradA,gradB,fit,bgFocus,bgOpacity,bgBlur,bgSaturation,uiScale,textScale,glassMode,glassOpacity,glassBlur,glassTint,glassBorder,glassRadius]);
  useEffect(() => { let active = true; void readBackground().then(image => { if (active) setBgImage(image); }).catch(() => undefined).finally(() => { if (active) setBackgroundReady(true); }); return () => { active = false; }; }, []);
  useEffect(() => { if (backgroundReady) void writeBackground(bgImage).catch(() => setError("Could not save that background image.")); }, [bgImage, backgroundReady]);
  useEffect(() => {
    if (!activeProfile) return;
    if (profile !== activeProfile.id) setProfile(activeProfile.id);
    localStorage.setItem("unnamed-profiles", JSON.stringify(profiles));
    localStorage.setItem("unnamed-active-profile", activeProfile.id);
  }, [profiles, profile, activeProfile]);
  useEffect(() => {
    if (!activeProfile) return;
    setDpi(activeProfile.dpi);
    setPolling(activeProfile.polling);
    void invoke("set_dpi", { dpi: activeProfile.dpi }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    void invoke("apply_button_mappings", { mappings: activeProfile.buttons }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [profile, activeProfile]);

  const refresh = useCallback(async () => { setLoading(true); setError(null); try { setMice(await invoke<MouseDevice[]>("detect_mice", { showHidden: showOtherDevices })); } catch (e) { setMice([]); setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); } }, [showOtherDevices]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { if (dpiTimer.current) clearTimeout(dpiTimer.current); }, []);
  const applyDpi = (value: number) => { setDpi(value); setProfiles(items => items.map(item => item.id === activeProfile?.id ? { ...item, dpi: value } : item)); setError(null); if (dpiTimer.current) clearTimeout(dpiTimer.current); dpiTimer.current = setTimeout(async () => { try { await invoke("set_dpi", { dpi: value }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, 300); };
  const setPollingForProfile = (value: string) => { setPolling(value); setProfiles(items => items.map(item => item.id === activeProfile?.id ? { ...item, polling: value } : item)); };
  const updateButton = (button: string, patch: Partial<ButtonBinding>) => setProfiles(items => items.map(item => item.id === activeProfile?.id ? { ...item, buttons: { ...item.buttons, [button]: { ...item.buttons[button], ...patch } } } : item));
  const askLocalAssistant = async () => {
    const question = localQuestion.trim();
    if (!question || localLoading) return;
    const userMessage: LocalMessage = { id: crypto.randomUUID(), role: "user", content: question };
    setError(null);
    setLocalMessages(messages => [...messages, userMessage]);
    setLocalQuestion("");
    setLocalLoading(true);
    try {
      const deviceContext = mouse ? `${mouse.name} · ${mouse.connection} · profile ${activeProfile?.name || "Default"} · ${dpi} DPI` : "No device detected";
      const reply = await invoke<string>("ask_local_assistant", { message: question, deviceContext });
      setLocalMessages(messages => [...messages, { id: crypto.randomUUID(), role: "assistant", content: reply }]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLocalLoading(false); }
  };
  const testButtonAction = async (binding: ButtonBinding) => { setError(null); try { await invoke("test_button_action", { action: binding.action, target: binding.target || null }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const recordMouseInput = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const input = ({ 0: "Button 1", 1: "Button 3", 2: "Button 2", 3: "Button 4", 4: "Button 5" } as Record<number, string>)[event.button];
    if (!input) return;
    setTestedInputs(inputs => [input, ...inputs.filter(item => item !== input)].slice(0, 6));
    setTesterStatus(`${input.replace("Button ", "M")} · ${input} detected`);
  };
  const recordScrollInput = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const input = event.deltaY < 0 ? "Wheel up" : "Wheel down";
    setTestedInputs(inputs => [input, ...inputs.filter(item => item !== input)].slice(0, 6));
    setTesterStatus(`${input} detected`);
  };
  const createProfile = () => { const name = newProfileName.trim(); if (!name) return setError("Give the new profile a name."); if (profiles.some(item => item.name.toLowerCase() === name.toLowerCase())) return setError("A profile with that name already exists."); const created = makeProfile(name, activeProfile); setProfiles(items => [...items, created]); setProfile(created.id); setNewProfileName(""); setError(null); };
  const renameProfile = (item: Profile) => { const name = window.prompt("Profile name", item.name)?.trim(); if (!name || name === item.name) return; if (profiles.some(other => other.id !== item.id && other.name.toLowerCase() === name.toLowerCase())) return setError("A profile with that name already exists."); setProfiles(items => items.map(other => other.id === item.id ? { ...other, name } : other)); };
  const deleteProfile = (item: Profile) => { if (profiles.length === 1) return setError("Keep at least one profile."); if (!window.confirm(`Delete "${item.name}"?`)) return; const remaining = profiles.filter(other => other.id !== item.id); setProfiles(remaining); if (profile === item.id) setProfile(remaining[0].id); };
  const inspectDpiHardware = async () => { setError(null); setDpiDiagnostics(null); try { const result = await invoke("inspect_dpi_hardware"); setDpiDiagnostics(JSON.stringify(result, null, 2)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };

  const importBackground = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) return setError("Use PNG, JPG/JPEG, WebP, or GIF."); if (file.size > 40 * 1024 * 1024) return setError("Background images must be 40 MB or smaller."); setError(null); try { setBgImage(await prepareBackground(file)); setBgMode("image"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare that image."); } finally { event.target.value = ""; } };
  const resetAppearance = () => { setBgMode("default"); setBgImage(""); setBgFocus("center"); setBgOpacity(100); setBgBlur(0); setBgSaturation(100); setGlassMode("regular"); setGlassOpacity(64); setGlassBlur(22); setGlassTint("#15171B"); setGlassBorder(42); setGlassRadius(16); setUiScale(100); setTextScale(100); };

  const mouse = mice.find(m => m.connected) ?? mice[0];
  const isG305 = mouse?.name.includes("G305") ?? false;
  const isModelO = mouse?.name.includes("Model O Wired") ?? false;
  const deviceButtons = isG305 || isModelO ? [...buttonNames, "Button 6"] : buttonNames;
  const deviceImage = isG305 ? "/assets/logitech/g305-top.png" : isModelO ? "/assets/glorious/model-o-wired-top.png" : "/assets/x1/attack-shark-x1-top.png";
  const dpiMinimum = isG305 ? 200 : 50;
  const dpiMaximum = isG305 || isModelO ? 12000 : 40000;
  const connected = Boolean(mouse?.connected);
  const background: React.CSSProperties = bgMode === "solid" ? { background: bgColor } : bgMode === "gradient" ? { background: `linear-gradient(135deg, ${gradA}, ${gradB})` } : bgMode === "image" && bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: fit === "stretch" ? "100% 100%" : fit, backgroundPosition: bgFocus, backgroundRepeat: "no-repeat" } : { background: "#101112" };

  const glassStyle = { "--glass-alpha": String(glassOpacity / 100), "--glass-blur": `${glassBlur}px`, "--glass-tint": glassTint, "--glass-border": String(glassBorder / 100), "--glass-radius": `${glassRadius}px`, "--text-scale": String(textScale / 100) } as React.CSSProperties;
  const changeTab = (next: Tab) => {
    if (next === tab) return;
    const page = document as Document & { startViewTransition?: (update: () => void) => unknown };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !page.startViewTransition) {
      setTab(next);
      return;
    }
    page.startViewTransition(() => setTab(next));
  };

  return <div className={`app-shell glass-${glassMode}`} style={glassStyle}>
    {showBoot && <div className={`app-boot-screen ${bootProgress === 100 ? "done" : ""}`} aria-label="Opening Unnamed Enhancements">
      <section className="app-boot-panel">
        <span className="app-boot-kicker">Preparing your app</span>
        <h1>Unnamed Enhancements</h1>
        <p>{bootProgress < 20 ? "Getting things ready..." : bootProgress < 78 ? "Setting up your workspace..." : "Almost there..."}</p>
        <strong>{bootProgress}%</strong>
        <div className="app-boot-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bootProgress}><i style={{ width: `${bootProgress}%` }} /></div>
      </section>
    </div>}
    <div className="background-layer" style={{ ...background, opacity: bgMode === "default" ? 1 : bgOpacity / 100, filter: `${bgBlur ? `blur(${bgBlur}px) ` : ""}saturate(${bgSaturation}%)` }} />
    <div className="background-shade" />
    <div className="ui-scale-layer" style={{ "--ui-scale": uiScale / 100 } as React.CSSProperties}>
      <aside className="sidebar glass-surface">
        <div className="brand"><div className="brand-mark"><Mouse size={19} /></div><div><div className="brand-name">Unnamed</div><div className="brand-subtitle">Mouse Control</div></div></div>
        <div className="sidebar-section-label">Configure</div>
        <nav className="nav-list">{tabs.map(({ id, label, icon: Icon }) => <button className={`nav-item ${tab === id ? "active" : ""}`} key={id} onClick={() => changeTab(id)} type="button"><Icon size={18}/><span>{label}</span></button>)}</nav>
        <div className="sidebar-spacer"/><div className="sidebar-device-card glass-surface"><span className={`device-dot ${connected ? "online" : ""}`}/><div className="device-card-copy"><strong>{mouse?.name || "No mouse detected"}</strong><span>{mouse?.connection || "Waiting for device"}</span></div><button className="icon-button" onClick={() => void refresh()} type="button"><RefreshCw size={15} className={loading ? "spin" : ""}/></button></div>
        <div className="sidebar-footer">Unnamed Desktop App <span>•</span> v0.1.0</div>
      </aside>
      <main className="content">
        <header className="topbar"><div><div className="eyebrow">{tab === "overview" ? "Device overview" : tabs.find(t => t.id === tab)?.label}</div><h1>{tab === "overview" ? "Mouse configuration" : tabs.find(t => t.id === tab)?.label}</h1></div><div className="topbar-actions"><span className="profile-label">Active profile</span><select className="profile-select glass-control" value={activeProfile?.id || ""} onChange={e => setProfile(e.target.value)}>{profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></header>
        {error && <div className="error-banner">{error}</div>}
        {tab === "overview" && <><section className="device-hero panel glass-surface"><div className="device-hero-copy"><div className="status-pill glass-control"><span className={`device-dot ${connected ? "online" : ""}`}/>{connected ? "Connected" : "Not connected"}</div><h2>{mouse?.name || "No mouse detected"}</h2><p>{connected ? "Connected and ready" : "Connect a mouse to begin configuring it"}</p><div className="device-meta">{mouse?.connection && <span>{mouse.connection}</span>}{mouse?.manufacturer && <span>{mouse.manufacturer}</span>}{mouse?.vid && mouse?.pid && <span>VID {mouse.vid} · PID {mouse.pid}</span>}</div><button className="primary-button glass-control" onClick={() => void refresh()} disabled={loading} type="button"><RefreshCw size={16}/> {loading ? "Scanning…" : "Scan for devices"}</button></div><div className="mouse-illustration"><img src={deviceImage} alt={isG305 ? "Black Logitech G305, top view" : isModelO ? "Black Glorious Model O Wired, top view" : "White Attack Shark X1, top view"}/></div></section><div className="section-heading"><div><h2>Quick settings</h2><p>Common controls for your current profile.</p></div></div><section className="settings-grid"><div className="setting-card panel glass-surface"><div className="setting-icon"><Gauge size={19}/></div><div className="setting-copy"><span>DPI</span><DpiInput value={dpi} onApply={applyDpi} compact minimum={dpiMinimum} maximum={dpiMaximum}/><small>Hardware sensitivity</small></div><input type="range" min={dpiMinimum} max={dpiMaximum} step="50" value={dpi} onChange={e => applyDpi(Number(e.target.value))}/><div className="dpi-preset-row">{dpiPresets.slice(0, 4).map(value => <button className={dpi === value ? "selected" : ""} key={value} onClick={() => applyDpi(value)} type="button">{value >= 1000 ? `${value / 1000}K` : value}</button>)}</div><small className="muted-warning">{isG305 ? "G305 range · 200–12,000 DPI." : isModelO ? "Model O range · 50–12,000 DPI." : "Hardware DPI control · 50–40,000 DPI."}</small></div><div className="setting-card panel glass-surface"><div className="setting-icon"><Zap size={19}/></div><div className="setting-copy"><span>Polling rate</span><strong>{polling}</strong><small>USB report rate</small></div><div className="segmented">{["125 Hz","500 Hz","1000 Hz"].map(r => <button className={polling === r ? "selected" : ""} key={r} onClick={() => setPollingForProfile(r)} type="button">{r.replace(" Hz","")}</button>)}</div></div><div className="setting-card panel glass-surface"><div className="setting-icon"><Keyboard size={19}/></div><div className="setting-copy"><span>Button layout</span><strong>{deviceButtons.length} buttons</strong><small>Ready to customise</small></div><button className="secondary-button glass-control" onClick={() => changeTab("buttons")} type="button">Configure</button></div></section></>}
        {tab === "buttons" && <section className="panel page-panel glass-surface"><div className="section-heading compact"><div><h2>Button mapping</h2><p>Choose a button, then configure its action in the editor below.</p></div><div className="page-status"><span className="device-dot online"/>Profile saved</div></div><div className="mapping-label-row"><span>Button</span><span>Control</span><span>Assigned action</span><span>Test</span></div><div className="button-map-grid">{deviceButtons.map(button => { const binding = buttons[button] || { action: "Default" as ButtonAction }; return <button className={`map-row glass-control ${selectedButton === button ? "editing" : ""}`} key={button} onClick={() => setSelectedButton(button)} type="button"><span className="button-key">{button.replace("Button ","M")}</span><span>{button}</span><span className="map-action-summary">{binding.action === "Keybind" ? binding.target || "Set keybind" : binding.action}</span><span className="map-test" title="Edit this button">›</span></button>; })}</div><div className="mouse-tester-toggle-row"><button className={`secondary-button glass-control mouse-tester-toggle ${testerOpen ? "selected" : ""}`} onClick={() => setTesterOpen(open => !open)} type="button">◉ {testerOpen ? "Close mouse tester" : "Test mouse inputs"}</button><span>Check clicks, side buttons, and scroll in this window.</span></div>{testerOpen && <section className="mouse-tester glass-control"><header><div><span>Live mouse tester</span><h3>{testerStatus}</h3></div><button className="secondary-button" onClick={() => { setTestedInputs([]); setTesterStatus("Waiting for an input"); }} type="button">Clear</button></header><div className="mouse-tester-pad" tabIndex={0} onMouseDown={recordMouseInput} onWheel={recordScrollInput} onContextMenu={event => event.preventDefault()}><strong>Click or scroll here</strong><span>Use left, right, wheel, or either side button while this area is focused.</span><div className="mouse-tester-inputs">{["Button 1","Button 2","Button 3","Button 4","Button 5","Wheel up","Wheel down"].map(input => <div className={testedInputs.includes(input) ? "detected" : ""} key={input}><b>{input.replace("Button ", "M").replace("Wheel ", "Scroll ")}</b><span>{testedInputs.includes(input) ? "Detected" : "Waiting"}</span></div>)}</div></div><p>It only observes inputs in this tester area—it does not change your button mappings.</p></section>}<div className="button-workspace"><div className="mouse-button-map glass-control"><div className="mouse-map-heading"><div><span>Interactive layout</span><h3>{isG305 ? "Logitech G305 LIGHTSPEED" : isModelO ? "Glorious Model O Wired" : "Attack Shark X1"}</h3></div><span>{selectedButton.replace("Button ", "M")} selected</span></div><div className={`mouse-map-canvas ${isG305 ? "g305-map" : isModelO ? "model-o-map" : "x1-map"}`}><img src={deviceImage} alt={isG305 ? "Logitech G305 button map" : isModelO ? "Glorious Model O Wired button map" : "Attack Shark X1 button map"}/>{mouseHotspots.filter(zone => deviceButtons.includes(zone.button)).map(zone => <button className={`${zone.className} ${selectedButton === zone.button ? "selected" : ""}`} key={zone.button} onClick={() => setSelectedButton(zone.button)} type="button" aria-label={`Edit ${zone.label}`}><b>{zone.button.replace("Button ", "M")}</b><span>{zone.label}</span></button>)}</div><p>Click a highlighted button on the mouse to edit it.</p></div>{(() => { const binding = buttons[selectedButton] || { action: "Default" as ButtonAction }; return <div className="button-editor glass-control"><div className="editor-heading"><div><span>Editing</span><h3>{selectedButton.replace("Button ", "M")} · {selectedButton}</h3></div><button className="map-test" onClick={() => void testButtonAction(binding)} type="button" title="Test this action"><Play size={14}/></button></div><div className="editor-section"><span>Action</span><select value={binding.action} onChange={e => updateButton(selectedButton, { action: e.target.value as ButtonAction, target: ["Keybind", "Custom program"].includes(e.target.value) ? binding.target || "" : undefined })}>{actions.map(action => <option key={action}>{action}</option>)}</select><div className="quick-actions"><button className={binding.action === "Keybind" ? "selected" : ""} onClick={() => updateButton(selectedButton, { action: "Keybind", target: binding.action === "Keybind" ? binding.target : "" })} type="button">⌨ Custom keybind</button><button className={binding.action === "Open Email" ? "selected" : ""} onClick={() => updateButton(selectedButton, { action: "Open Email" })} type="button">✉ Open email</button></div></div>{binding.action === "Keybind" && <div className="editor-section keybind-section"><span>Custom keybind</span><KeybindInput value={binding.target || ""} onChange={target => updateButton(selectedButton, { target })}/><div className="keybind-presets">{keybindPresets.map(key => <button key={key} onClick={() => updateButton(selectedButton, { target: key })} className={binding.target === key ? "selected" : ""} type="button">{key}</button>)}</div></div>}{binding.action === "Custom program" && <div className="editor-section"><span>Program path</span><input className="map-target" value={binding.target || ""} placeholder="e.g. notepad.exe" onChange={e => updateButton(selectedButton, { target: e.target.value })}/></div>}<p>{selectedButton === "Button 4" || selectedButton === "Button 5" ? "This action runs while Unnamed is open." : "This profile setting is saved. Hardware remapping for M1–M3 needs the X1’s native command format."}</p></div>; })()}</div><p className="mapping-note">Presets can launch Explorer, Task Manager, Settings, or your default email app. Keybinds send to whichever app is currently active.</p></section>}
        {tab === "performance" && <section className="panel page-panel glass-surface"><div className="section-heading compact"><div><h2>Performance</h2><p>Fine-tune sensitivity and responsiveness.</p></div></div><div className="performance-layout"><div className="performance-value"><span>Current DPI</span><DpiInput value={dpi} onApply={applyDpi} minimum={dpiMinimum} maximum={dpiMaximum}/><small>{isG305 ? "G305 range · 200–12,000 DPI." : isModelO ? "Model O range · 50–12,000 DPI." : "Hardware DPI control · 50–40,000 DPI."}</small></div><div className="performance-slider"><input className="big-range" type="range" min={dpiMinimum} max={dpiMaximum} step="50" value={dpi} onChange={e => applyDpi(Number(e.target.value))}/><div className="dpi-preset-row full">{dpiPresets.map(value => <button className={dpi === value ? "selected" : ""} key={value} onClick={() => applyDpi(value)} type="button">{value >= 1000 ? `${value / 1000}K` : value}</button>)}</div></div></div><div className="polling-options"><span>Polling rate</span>{["125 Hz","500 Hz","1000 Hz"].map(r => <button className={polling === r ? "selected" : ""} key={r} onClick={() => setPollingForProfile(r)} type="button">{r}</button>)}</div><div className="dpi-diagnostics"><button className="secondary-button glass-control" onClick={() => void inspectDpiHardware()} type="button">Collect DPI diagnostics</button><p>Read-only: this records the mouse’s HID interfaces and descriptor without changing its settings.</p>{dpiDiagnostics && <pre>{dpiDiagnostics}</pre>}</div></section>}
        {tab === "profiles" && <section className="panel page-panel glass-surface"><div className="section-heading compact"><div><h2>Profiles</h2><p>Create and switch saved DPI, polling, and button layouts.</p></div></div><div className="profile-create glass-control"><input value={newProfileName} placeholder="New profile name" onChange={e => setNewProfileName(e.target.value)} onKeyDown={e => e.key === "Enter" && createProfile()}/><button className="secondary-button" onClick={createProfile} type="button"><Plus size={15}/> Create profile</button></div><div className="profile-grid">{profiles.map(item => <div className={`profile-card glass-control ${activeProfile?.id === item.id ? "selected" : ""}`} key={item.id}><Gamepad2 size={19}/><strong>{item.name}</strong><span>{item.dpi} DPI · {item.polling}</span><div className="profile-card-actions"><button onClick={() => setProfile(item.id)} type="button">{activeProfile?.id === item.id ? "Active" : "Use"}</button><button onClick={() => renameProfile(item)} type="button">Rename</button><button className="danger-button" onClick={() => deleteProfile(item)} type="button" title="Delete profile"><Trash2 size={14}/></button></div></div>)}</div></section>}
        {tab === "help" && <section className="panel page-panel glass-surface help-panel"><div className="section-heading compact"><div><h2>User Manual</h2><p>Quick answers for getting the most out of Unnamed.</p></div></div><div className="help-grid"><article className="help-card glass-control"><h3>Connect your mouse</h3><p>Plug in USB-C or the 2.4 GHz receiver, then use <b>Scan for devices</b> on Overview. The card confirms the detected name and connection.</p></article><article className="help-card glass-control"><h3>Change DPI</h3><p>Use Performance or Quick settings. Type a number directly or use the slider. The X1 can apply supported hardware DPI; other detected mice keep their values as profile settings until their exact protocol is verified.</p></article><article className="help-card glass-control"><h3>Remap buttons</h3><p>Open Buttons, click the physical mouse button, choose an action, then set a custom keybind or a preset such as Explorer, Task Manager, Settings, or Email.</p></article><article className="help-card glass-control"><h3>Profiles</h3><p>Create profiles for work, gaming, or different games. Each profile remembers its DPI, polling selection, and button layout on this PC.</p></article><article className="help-card glass-control"><h3>Appearance</h3><p>Settings lets you use a photo or animated GIF background, adjust blur and glass transparency, and scale the interface. These changes save automatically.</p></article><article className="help-card glass-control"><h3>Need a clean reset?</h3><p>Use <b>Reset appearance</b> in Settings for the visual theme. If a mouse is not found, unplug and reconnect it, then scan again.</p></article></div><div className="help-note">Tip: do not use third-party mouse software at the same time as Unnamed when testing button mappings; it can override the active mapping.</div></section>}
        {tab === "assistant" && <section className="panel page-panel glass-surface local-ai-panel">
          <div className="section-heading compact"><div><h2>Local AI</h2><p>Private help for Unnamed and everyday PC questions.</p></div><span className="local-ai-badge"><Bot size={14}/> Runs on this PC</span></div>
          <div className="local-ai-card glass-control">
            <div className="local-ai-chat" aria-live="polite" role="log">
              {!localMessages.length && !localLoading && <div className="local-ai-intro"><span className="local-ai-avatar"><Bot size={16}/></span><div><strong>Unnamed Local AI</strong><p>Ask about your mouse, profiles, DPI, or Windows. It stays on this PC.</p></div></div>}
              {localMessages.map(message => <article className={`local-ai-message ${message.role}`} key={message.id}>
                <span className="local-ai-avatar">{message.role === "assistant" ? <Bot size={16}/> : "Y"}</span>
                <div><header><strong>{message.role === "assistant" ? "Unnamed Local AI" : "You"}</strong><span>{message.role === "assistant" ? "Local" : "Just now"}</span></header><p>{message.content}</p></div>
              </article>)}
              {localLoading && <article className="local-ai-message assistant local-ai-thinking"><span className="local-ai-avatar"><Bot size={16}/></span><div><header><strong>Unnamed Local AI</strong><span>Local</span></header><p><i></i><i></i><i></i></p></div></article>}
            </div>
            <label className="local-ai-composer"><textarea value={localQuestion} placeholder="Message Local AI" onChange={event => setLocalQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void askLocalAssistant(); } }}/><div className="local-ai-actions"><span>Enter to send · Shift + Enter for a new line</span><button className="local-ai-send" aria-label="Send message" disabled={localLoading || !localQuestion.trim()} onClick={() => void askLocalAssistant()} type="button"><SendHorizontal size={17}/></button></div></label>
            <details className="local-ai-setup"><summary>Local AI setup</summary><div><p>Install Ollama, then run this once in PowerShell:</p><code>ollama pull qwen2.5:3b-instruct</code><small>After that, it runs locally with no account or API key.</small></div></details>
          </div>
        </section>}
        {tab === "settings" && <section className="panel page-panel background-settings glass-surface"><div className="section-heading compact"><div><h2>Appearance</h2><p>Make the background and interface as transparent as you want.</p></div></div>
          <div className="appearance-section"><h3>Background</h3><div className="background-mode-grid">{([["default","Default"],["solid","Solid colour"],["gradient","Gradient"],["image","Image"]] as [BackgroundMode,string][]).map(([mode,label]) => <button className={`background-mode glass-control ${bgMode === mode ? "selected" : ""}`} key={mode} onClick={() => setBgMode(mode)} type="button"><Palette size={17}/><span>{label}</span></button>)}</div>
          {bgMode === "solid" && <div className="background-control"><HexColor label="Colour" value={bgColor} onChange={setBgColor}/></div>}
          {bgMode === "gradient" && <div className="gradient-controls background-control"><HexColor label="Start" value={gradA} onChange={setGradA}/><HexColor label="End" value={gradB} onChange={setGradB}/></div>}
          {bgMode === "image" && <><div className="import-box glass-control"><label className="import-button"><Upload size={15}/> Import image<input className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={importBackground}/></label><span>PNG, JPG/JPEG, WebP or animated GIF · max 40 MB · smaller still images are high-quality scaled to 2560px</span></div><div className="image-controls"><label>Fit<select value={fit} onChange={e => setFit(e.target.value as ImageFit)}><option value="cover">Cover</option><option value="contain">Contain</option><option value="stretch">Stretch</option></select></label><label>Focus<select value={bgFocus} onChange={e => setBgFocus(e.target.value)}><option value="center">Centre</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="left">Left</option><option value="right">Right</option></select></label><label>Background opacity <b>{bgOpacity}%</b><input type="range" min="20" max="100" value={bgOpacity} onChange={e => setBgOpacity(Number(e.target.value))}/></label><label>Background blur <b>{bgBlur}px</b><input type="range" min="0" max="24" value={bgBlur} onChange={e => setBgBlur(Number(e.target.value))}/></label><label>Image saturation <b>{bgSaturation}%</b><input type="range" min="0" max="160" value={bgSaturation} onChange={e => setBgSaturation(Number(e.target.value))}/></label></div></>}
          </div>
          <div className="appearance-section"><h3>Liquid Glass</h3><p className="appearance-note">The glass layer is separate from the background, so you can reveal more or less of your image without changing its scale.</p><div className="glass-presets"><button className={glassMode === "regular" ? "selected" : ""} onClick={() => setGlassMode("regular")} type="button">Regular</button><button className={glassMode === "clear" ? "selected" : ""} onClick={() => setGlassMode("clear")} type="button">Clear</button></div><div className="glass-controls-grid"><label>UI transparency <b>{100-glassOpacity}%</b><input type="range" min="18" max="82" value={glassOpacity} onChange={e => setGlassOpacity(Number(e.target.value))}/></label><label>Glass blur <b>{glassBlur}px</b><input type="range" min="4" max="40" value={glassBlur} onChange={e => setGlassBlur(Number(e.target.value))}/></label><label>Glass tint <HexColor label="" value={glassTint} onChange={setGlassTint}/></label><label>Border strength <b>{glassBorder}%</b><input type="range" min="10" max="80" value={glassBorder} onChange={e => setGlassBorder(Number(e.target.value))}/></label><label>Corner radius <b>{glassRadius}px</b><input type="range" min="8" max="28" value={glassRadius} onChange={e => setGlassRadius(Number(e.target.value))}/></label></div></div>
          <div className="appearance-section"><h3>Interface scale</h3><div className="scale-row"><span>Layout</span><input type="range" min="75" max="125" step="5" value={uiScale} onChange={e => setUiScale(Number(e.target.value))}/><b>{uiScale}%</b></div><div className="scale-row text-scale-control"><span>Text</span><input type="range" min="85" max="125" step="5" value={textScale} onChange={e => setTextScale(Number(e.target.value))}/><b>{textScale}%</b></div></div>
          <button className="reset-background" onClick={resetAppearance} type="button">Reset appearance</button>
          <div className="appearance-section"><h3>Application</h3><label className="toggle-row"><span><strong>Show other connected mouse devices</strong><small>Include generic pointing devices in detection.</small></span><input checked={showOtherDevices} onChange={e => setShowOtherDevices(e.target.checked)} type="checkbox"/></label><p className="settings-saved-note">Appearance and profile changes save automatically on this PC.</p></div>
        </section>}
      </main>
    </div>
  </div>;
}
