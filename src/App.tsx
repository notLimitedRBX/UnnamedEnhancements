import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, CircleHelp, Gauge, Gamepad2, ImagePlus, Keyboard, Mouse, Palette, RefreshCw, Settings, SlidersHorizontal, Upload, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MouseDevice = { id: string; name: string; manufacturer: string | null; vid: string | null; pid: string | null; connection: string; connected: boolean };
type Tab = "overview" | "buttons" | "performance" | "profiles" | "settings";
type BackgroundMode = "default" | "solid" | "gradient" | "image";
type ImageFit = "cover" | "contain" | "stretch";
type GlassMode = "regular" | "clear";

const tabs: { id: Tab; label: string; icon: typeof Mouse }[] = [
  { id: "overview", label: "Overview", icon: Mouse }, { id: "buttons", label: "Buttons", icon: SlidersHorizontal },
  { id: "performance", label: "Performance", icon: Gauge }, { id: "profiles", label: "Profiles", icon: Gamepad2 }, { id: "settings", label: "Settings", icon: Settings },
];
const actions = ["Left Click", "Right Click", "Middle Click", "Back", "Forward", "DPI Up", "DPI Down", "Disabled"];

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

export default function App() {
  const [profile, setProfile] = useState("Default");
  const [tab, setTab] = useState<Tab>("overview");
  const [mice, setMice] = useState<MouseDevice[]>([]);
  const [showOtherDevices, setShowOtherDevices] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dpi, setDpi] = useState(800);
  const [dpiDiagnostics, setDpiDiagnostics] = useState<string | null>(null);
  const [polling, setPolling] = useState("1000 Hz");
  const [textScale, setTextScale] = useState(() => Number(localStorage.getItem("unnamed-text-scale") || 100));
  const [mouseAssetIndex, setMouseAssetIndex] = useState(() => Number(localStorage.getItem("unnamed-x1-image-index") || 0));
  const mouseAssets = ["/assets/x1/attack-shark-x1-1.png", "/assets/x1/attack-shark-x1-2.png", "/assets/x1/attack-shark-x1-3.png", "/assets/x1/attack-shark-x1-4.png"];
  const dpiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [buttons, setButtons] = useState<Record<string, string>>({ "Button 1": "Left Click", "Button 2": "Right Click", "Button 3": "Middle Click", "Button 4": "Back", "Button 5": "Forward" });

  const [bgMode, setBgMode] = useState<BackgroundMode>(() => (localStorage.getItem("unnamed-bg-mode") as BackgroundMode) || "default");
  const [bgColor, setBgColor] = useState(() => localStorage.getItem("unnamed-bg-color") || "#101112");
  const [gradA, setGradA] = useState(() => localStorage.getItem("unnamed-bg-gradient-from") || "#101112");
  const [gradB, setGradB] = useState(() => localStorage.getItem("unnamed-bg-gradient-to") || "#202124");
  const [bgImage, setBgImage] = useState(() => localStorage.getItem("unnamed-bg-image") || "");
  const [fit, setFit] = useState<ImageFit>(() => (localStorage.getItem("unnamed-bg-fit") as ImageFit) || "cover");
  const [bgOpacity, setBgOpacity] = useState(() => Number(localStorage.getItem("unnamed-bg-opacity") || 100));
  const [bgBlur, setBgBlur] = useState(() => Number(localStorage.getItem("unnamed-bg-blur") || 0));
  const [uiScale, setUiScale] = useState(() => Number(localStorage.getItem("unnamed-ui-scale") || 100));

  const [glassMode, setGlassMode] = useState<GlassMode>(() => (localStorage.getItem("unnamed-glass-mode") as GlassMode) || "regular");
  const [glassOpacity, setGlassOpacity] = useState(() => Number(localStorage.getItem("unnamed-glass-opacity") || 64));
  const [glassBlur, setGlassBlur] = useState(() => Number(localStorage.getItem("unnamed-glass-blur") || 22));
  const [glassTint, setGlassTint] = useState(() => localStorage.getItem("unnamed-glass-tint") || "#15171B");
  const [glassBorder, setGlassBorder] = useState(() => Number(localStorage.getItem("unnamed-glass-border") || 42));
  const [glassRadius, setGlassRadius] = useState(() => Number(localStorage.getItem("unnamed-glass-radius") || 16));

  useEffect(() => { localStorage.setItem("unnamed-bg-mode", bgMode); localStorage.setItem("unnamed-bg-color", bgColor); localStorage.setItem("unnamed-bg-gradient-from", gradA); localStorage.setItem("unnamed-bg-gradient-to", gradB); localStorage.setItem("unnamed-bg-fit", fit); localStorage.setItem("unnamed-bg-opacity", String(bgOpacity)); localStorage.setItem("unnamed-bg-blur", String(bgBlur)); localStorage.setItem("unnamed-ui-scale", String(uiScale)); localStorage.setItem("unnamed-glass-mode", glassMode); localStorage.setItem("unnamed-glass-opacity", String(glassOpacity)); localStorage.setItem("unnamed-glass-blur", String(glassBlur)); localStorage.setItem("unnamed-glass-tint", glassTint); localStorage.setItem("unnamed-glass-border", String(glassBorder)); localStorage.setItem("unnamed-glass-radius", String(glassRadius)); }, [bgMode,bgColor,gradA,gradB,fit,bgOpacity,bgBlur,uiScale,glassMode,glassOpacity,glassBlur,glassTint,glassBorder,glassRadius]);
  useEffect(() => { if (bgImage) localStorage.setItem("unnamed-bg-image", bgImage); else localStorage.removeItem("unnamed-bg-image"); }, [bgImage]);

  const refresh = useCallback(async () => { setLoading(true); setError(null); try { setMice(await invoke<MouseDevice[]>("detect_mice", { showHidden: showOtherDevices })); } catch (e) { setMice([]); setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); } }, [showOtherDevices]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { if (dpiTimer.current) clearTimeout(dpiTimer.current); }, []);
  const applyDpi = (value: number) => { setDpi(value); setError(null); if (dpiTimer.current) clearTimeout(dpiTimer.current); dpiTimer.current = setTimeout(async () => { try { await invoke("set_dpi", { dpi: value }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, 300); };
  const inspectDpiHardware = async () => { setError(null); setDpiDiagnostics(null); try { const result = await invoke("inspect_dpi_hardware"); setDpiDiagnostics(JSON.stringify(result, null, 2)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };

  const importBackground = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) return setError("Use PNG, JPG/JPEG, or WebP."); if (file.size > 8 * 1024 * 1024) return setError("Background images must be 8 MB or smaller."); const reader = new FileReader(); reader.onload = () => { setBgImage(String(reader.result)); setBgMode("image"); setError(null); }; reader.readAsDataURL(file); event.target.value = ""; };
  const resetAppearance = () => { setBgMode("default"); setBgImage(""); setBgOpacity(100); setBgBlur(0); setGlassMode("regular"); setGlassOpacity(64); setGlassBlur(22); setGlassTint("#15171B"); setGlassBorder(42); setGlassRadius(16); setUiScale(100); };

  const mouse = mice.find(m => m.connected) ?? mice[0];
  const connected = Boolean(mouse?.connected);
  const background: React.CSSProperties = bgMode === "solid" ? { background: bgColor } : bgMode === "gradient" ? { background: `linear-gradient(135deg, ${gradA}, ${gradB})` } : bgMode === "image" && bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: fit === "stretch" ? "100% 100%" : fit, backgroundPosition: "center", backgroundRepeat: "no-repeat" } : { background: "#101112" };

  const glassStyle = { "--glass-alpha": String(glassOpacity / 100), "--glass-blur": `${glassBlur}px`, "--glass-tint": glassTint, "--glass-border": String(glassBorder / 100), "--glass-radius": `${glassRadius}px`, "--text-scale": String(textScale / 100) } as React.CSSProperties;

  return <div className={`app-shell glass-${glassMode}`} style={glassStyle}>
    <div className="background-layer" style={{ ...background, opacity: bgMode === "default" ? 1 : bgOpacity / 100, filter: bgBlur ? `blur(${bgBlur}px)` : undefined }} />
    <div className="background-shade" />
    <div className="ui-scale-layer" style={{ "--ui-scale": uiScale / 100 } as React.CSSProperties}>
      <aside className="sidebar glass-surface">
        <div className="brand"><div className="brand-mark"><Mouse size={19} /></div><div><div className="brand-name">Unnamed</div><div className="brand-subtitle">Mouse Control</div></div></div>
        <div className="sidebar-section-label">Configure</div>
        <nav className="nav-list">{tabs.map(({ id, label, icon: Icon }) => <button className={`nav-item ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id)} type="button"><Icon size={18}/><span>{label}</span></button>)}</nav>
        <div className="sidebar-spacer"/><div className="sidebar-device-card glass-surface"><span className={`device-dot ${connected ? "online" : ""}`}/><div className="device-card-copy"><strong>{mouse?.name || "No mouse detected"}</strong><span>{mouse?.connection || "Waiting for device"}</span></div><button className="icon-button" onClick={() => void refresh()} type="button"><RefreshCw size={15} className={loading ? "spin" : ""}/></button></div>
        <div className="sidebar-footer">Unnamed Desktop App <span>•</span> v0.1.0</div>
      </aside>
      <main className="content">
        <header className="topbar"><div><div className="eyebrow">{tab === "overview" ? "Device overview" : tabs.find(t => t.id === tab)?.label}</div><h1>{tab === "overview" ? "Mouse configuration" : tabs.find(t => t.id === tab)?.label}</h1></div><div className="topbar-actions"><button className="help-button glass-control" type="button"><CircleHelp size={17}/> Help</button><select className="profile-select glass-control" value={profile} onChange={e => setProfile(e.target.value)}><option>Default</option><option>Gaming</option><option>FPS</option><option>Custom</option></select></div></header>
        {error && <div className="error-banner">{error}</div>}
        {tab === "overview" && <><section className="device-hero panel glass-surface"><div className="device-hero-copy"><div className="status-pill glass-control"><span className={`device-dot ${connected ? "online" : ""}`}/>{connected ? "Connected" : "Not connected"}</div><h2>{mouse?.name || "No mouse detected"}</h2><p>{connected ? "Connected and ready" : "Connect a mouse to begin configuring it"}</p><div className="device-meta">{mouse?.connection && <span>{mouse.connection}</span>}{mouse?.manufacturer && <span>{mouse.manufacturer}</span>}{mouse?.vid && mouse?.pid && <span>VID {mouse.vid} · PID {mouse.pid}</span>}</div><button className="primary-button glass-control" onClick={() => void refresh()} disabled={loading} type="button"><RefreshCw size={16}/> {loading ? "Scanning…" : "Scan for devices"}</button></div><div className="mouse-illustration"><button className="mouse-image-arrow left" type="button" aria-label="Previous mouse image" onClick={() => setMouseAssetIndex(i => (i - 1 + mouseAssets.length) % mouseAssets.length)}><ChevronLeft size={18}/></button><img src={mouseAssets[mouseAssetIndex % mouseAssets.length]} alt="White Attack Shark X1"/><button className="mouse-image-arrow right" type="button" aria-label="Next mouse image" onClick={() => setMouseAssetIndex(i => (i + 1) % mouseAssets.length)}><ChevronRight size={18}/></button><div className="mouse-image-count">{(mouseAssetIndex % mouseAssets.length) + 1} / {mouseAssets.length}</div></div></section><div className="section-heading"><div><h2>Quick settings</h2><p>Common controls for your current profile.</p></div></div><section className="settings-grid"><div className="setting-card panel glass-surface"><div className="setting-icon"><Gauge size={19}/></div><div className="setting-copy"><span>DPI</span><strong>{dpi}</strong><small>Hardware sensitivity</small></div><input type="range" min="50" max="22000" step="50" value={dpi} onChange={e => applyDpi(Number(e.target.value))}/><small className="muted-warning">Hardware DPI write is currently being rebuilt.</small></div><div className="setting-card panel glass-surface"><div className="setting-icon"><Zap size={19}/></div><div className="setting-copy"><span>Polling rate</span><strong>{polling}</strong><small>USB report rate</small></div><div className="segmented">{["125 Hz","500 Hz","1000 Hz"].map(r => <button className={polling === r ? "selected" : ""} key={r} onClick={() => setPolling(r)} type="button">{r.replace(" Hz","")}</button>)}</div></div><div className="setting-card panel glass-surface"><div className="setting-icon"><Keyboard size={19}/></div><div className="setting-copy"><span>Button layout</span><strong>5 buttons</strong><small>Ready to customise</small></div><button className="secondary-button glass-control" onClick={() => setTab("buttons")} type="button">Configure</button></div></section></>}
        {tab === "buttons" && <section className="panel page-panel glass-surface"><div className="section-heading compact"><div><h2>Button mapping</h2><p>Choose an action for each mouse button.</p></div></div><div className="button-map-grid">{Object.entries(buttons).map(([button, action]) => <label className="map-row glass-control" key={button}><span className="button-key">{button.replace("Button ","M")}</span><span>{button}</span><select value={action} onChange={e => setButtons(v => ({...v,[button]:e.target.value}))}>{actions.map(a => <option key={a}>{a}</option>)}</select></label>)}</div></section>}
        {tab === "performance" && <section className="panel page-panel glass-surface"><div className="section-heading compact"><div><h2>Performance</h2><p>Fine-tune sensitivity and responsiveness.</p></div></div><div className="performance-layout"><div className="performance-value"><span>Current DPI</span><strong>{dpi}</strong><small>Hardware DPI write is currently being rebuilt.</small></div><input className="big-range" type="range" min="50" max="22000" step="50" value={dpi} onChange={e => applyDpi(Number(e.target.value))}/></div><div className="polling-options"><span>Polling rate</span>{["125 Hz","500 Hz","1000 Hz"].map(r => <button className={polling === r ? "selected" : ""} key={r} onClick={() => setPolling(r)} type="button">{r}</button>)}</div><div className="dpi-diagnostics"><button className="secondary-button glass-control" onClick={() => void inspectDpiHardware()} type="button">Collect DPI diagnostics</button><p>Read-only: this records the mouse’s HID interfaces and descriptor without changing its settings.</p>{dpiDiagnostics && <pre>{dpiDiagnostics}</pre>}</div></section>}
        {tab === "profiles" && <section className="panel page-panel glass-surface"><div className="section-heading compact"><div><h2>Profiles</h2><p>Switch between configurations without losing your settings.</p></div></div><div className="profile-grid">{["Default","Gaming","FPS","Custom"].map(p => <button className={`profile-card glass-control ${profile === p ? "selected" : ""}`} key={p} onClick={() => setProfile(p)} type="button"><Gamepad2 size={19}/><strong>{p}</strong><span>{profile === p ? "Active profile" : "Click to activate"}</span></button>)}</div></section>}
        {tab === "settings" && <section className="panel page-panel background-settings glass-surface"><div className="section-heading compact"><div><h2>Appearance</h2><p>Make the background and interface as transparent as you want.</p></div></div>
          <div className="appearance-section"><h3>Background</h3><div className="background-mode-grid">{([["default","Default"],["solid","Solid colour"],["gradient","Gradient"],["image","Image"]] as [BackgroundMode,string][]).map(([mode,label]) => <button className={`background-mode glass-control ${bgMode === mode ? "selected" : ""}`} key={mode} onClick={() => setBgMode(mode)} type="button"><Palette size={17}/><span>{label}</span></button>)}</div>
          {bgMode === "solid" && <div className="background-control"><HexColor label="Colour" value={bgColor} onChange={setBgColor}/></div>}
          {bgMode === "gradient" && <div className="gradient-controls background-control"><HexColor label="Start" value={gradA} onChange={setGradA}/><HexColor label="End" value={gradB} onChange={setGradB}/></div>}
          {bgMode === "image" && <><div className="import-box glass-control"><label className="import-button"><Upload size={15}/> Import image<input className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={importBackground}/></label><span>PNG, JPG/JPEG or WebP · max 8 MB</span></div><div className="image-controls"><label>Fit<select value={fit} onChange={e => setFit(e.target.value as ImageFit)}><option value="cover">Cover</option><option value="contain">Contain</option><option value="stretch">Stretch</option></select></label><label>Background opacity <b>{bgOpacity}%</b><input type="range" min="20" max="100" value={bgOpacity} onChange={e => setBgOpacity(Number(e.target.value))}/></label><label>Background blur <b>{bgBlur}px</b><input type="range" min="0" max="24" value={bgBlur} onChange={e => setBgBlur(Number(e.target.value))}/></label></div></>}
          </div>
          <div className="appearance-section"><h3>Liquid Glass</h3><p className="appearance-note">The glass layer is separate from the background, so you can reveal more or less of your image without changing its scale.</p><div className="glass-presets"><button className={glassMode === "regular" ? "selected" : ""} onClick={() => setGlassMode("regular")} type="button">Regular</button><button className={glassMode === "clear" ? "selected" : ""} onClick={() => setGlassMode("clear")} type="button">Clear</button></div><div className="glass-controls-grid"><label>UI transparency <b>{100-glassOpacity}%</b><input type="range" min="18" max="82" value={glassOpacity} onChange={e => setGlassOpacity(Number(e.target.value))}/></label><label>Glass blur <b>{glassBlur}px</b><input type="range" min="4" max="40" value={glassBlur} onChange={e => setGlassBlur(Number(e.target.value))}/></label><label>Glass tint <HexColor label="" value={glassTint} onChange={setGlassTint}/></label><label>Border strength <b>{glassBorder}%</b><input type="range" min="10" max="80" value={glassBorder} onChange={e => setGlassBorder(Number(e.target.value))}/></label><label>Corner radius <b>{glassRadius}px</b><input type="range" min="8" max="28" value={glassRadius} onChange={e => setGlassRadius(Number(e.target.value))}/></label></div></div>
          <div className="appearance-section"><h3>Interface scale</h3><div className="scale-row"><input type="range" min="75" max="125" step="5" value={uiScale} onChange={e => setUiScale(Number(e.target.value))}/><b>{uiScale}%</b></div></div>
          <button className="reset-background" onClick={resetAppearance} type="button">Reset appearance</button>
          <div className="appearance-section"><h3>Application</h3><label className="toggle-row"><span><strong>Show other connected mouse devices</strong><small>Include generic pointing devices in detection.</small></span><input checked={showOtherDevices} onChange={e => setShowOtherDevices(e.target.checked)} type="checkbox"/></label><label className="toggle-row"><span><strong>Minimise to tray</strong><small>Keep Unnamed running when the window is closed.</small></span><input type="checkbox" defaultChecked/></label></div>
        </section>}
      </main>
    </div>
  </div>;
}
