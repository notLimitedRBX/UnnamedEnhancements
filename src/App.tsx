import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, CircleHelp, Gauge, Gamepad2, Keyboard, Mouse, RefreshCw, Settings, SlidersHorizontal, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type MouseDevice = { id: string; name: string; manufacturer: string | null; vid: string | null; pid: string | null; connection: string; connected: boolean };
type Tab = "overview" | "buttons" | "performance" | "profiles" | "settings";
const tabs: { id: Tab; label: string; icon: typeof Mouse }[] = [
  { id: "overview", label: "Overview", icon: Mouse },
  { id: "buttons", label: "Buttons", icon: SlidersHorizontal },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "profiles", label: "Profiles", icon: Gamepad2 },
  { id: "settings", label: "Settings", icon: Settings },
];
const actions = ["Left Click", "Right Click", "Middle Click", "Back", "Forward", "DPI Up", "DPI Down", "Disabled"];

export default function App() {
  const [profile, setProfile] = useState("Default");
  const [tab, setTab] = useState<Tab>("overview");
  const [mice, setMice] = useState<MouseDevice[]>([]);
  const [showOtherDevices, setShowOtherDevices] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplyingDpi, setIsApplyingDpi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dpi, setDpi] = useState(800);
  const [polling, setPolling] = useState("1000 Hz");
  const [buttonActions, setButtonActions] = useState<Record<string, string>>({ "Button 1": "Left Click", "Button 2": "Right Click", "Button 3": "Middle Click", "Button 4": "Back", "Button 5": "Forward" });

  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const detectedMice = await invoke<MouseDevice[]>("detect_mice", { showHidden: showOtherDevices });
      setMice(detectedMice);
    } catch (reason) {
      setMice([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setIsLoading(false); }
  }, [showOtherDevices]);

  useEffect(() => { void refreshDevices(); }, [refreshDevices]);

  const applyDpi = useCallback(async (nextDpi: number) => {
    setDpi(nextDpi);
    setIsApplyingDpi(true);
    setError(null);
    try {
      await invoke("set_dpi", { dpi: nextDpi });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setIsApplyingDpi(false); }
  }, []);

  const selectedMouse = mice.find((mouse) => mouse.connected) ?? mice[0];
  const mouseLabel = selectedMouse?.name ?? "No mouse detected";
  const connectionLabel = selectedMouse?.connection ?? "Waiting for device";
  const connected = Boolean(selectedMouse?.connected);
  const deviceSummary = useMemo(() => connected ? "Connected and ready" : "Connect a mouse to begin configuring it", [connected]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Mouse size={19} strokeWidth={2.4} /></div><div><div className="brand-name">Unnamed</div><div className="brand-subtitle">Mouse Control</div></div></div>
        <div className="sidebar-section-label">Configure</div>
        <nav className="nav-list" aria-label="Main navigation">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)} type="button"><Icon size={18} /><span>{label}</span></button>)}</nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-device-card"><div className="device-dot-wrap"><span className={`device-dot ${connected ? "online" : ""}`} /></div><div className="device-card-copy"><strong>{mouseLabel}</strong><span>{connectionLabel}</span></div><button className="icon-button" title="Refresh devices" onClick={() => void refreshDevices()} type="button"><RefreshCw size={15} className={isLoading ? "spin" : ""} /></button></div>
        <div className="sidebar-footer">Unnamed Desktop App <span>•</span> v0.1.0</div>
      </aside>

      <main className="content">
        <header className="topbar"><div><div className="eyebrow">{tab === "overview" ? "Device overview" : tabs.find((item) => item.id === tab)?.label}</div><h1>{tab === "overview" ? "Mouse configuration" : tabs.find((item) => item.id === tab)?.label}</h1></div><div className="topbar-actions"><button className="help-button" type="button"><CircleHelp size={17} /> Help</button><div className="profile-picker"><span>Profile</span><select value={profile} onChange={(event) => setProfile(event.target.value)} aria-label="Profile"><option>Default</option><option>Gaming</option><option>FPS</option><option>Custom</option></select><ChevronDown size={15} className="select-chevron" /></div></div></header>
        {error && <div className="error-banner">{error}</div>}

        {tab === "overview" && <>
          <section className="device-hero panel"><div className="device-hero-copy"><div className="status-pill"><span className={`device-dot ${connected ? "online" : ""}`} /> {connected ? "Connected" : "Not connected"}</div><h2>{mouseLabel}</h2><p>{deviceSummary}</p><div className="device-meta"><span>{connectionLabel}</span>{selectedMouse?.manufacturer && <span>{selectedMouse.manufacturer}</span>}{selectedMouse?.vid && selectedMouse?.pid && <span>VID {selectedMouse.vid} · PID {selectedMouse.pid}</span>}</div><button className="primary-button" onClick={() => void refreshDevices()} disabled={isLoading} type="button"><RefreshCw size={16} className={isLoading ? "spin" : ""} /> {isLoading ? "Scanning…" : "Scan for devices"}</button></div><div className="mouse-illustration" aria-hidden="true"><div className="mouse-body"><div className="mouse-wheel"><span /></div><div className="mouse-line" /></div></div></section>
          <div className="section-heading"><div><h2>Quick settings</h2><p>Common controls for your current profile.</p></div></div>
          <section className="settings-grid">
            <div className="setting-card panel"><div className="setting-icon"><Gauge size={19} /></div><div className="setting-copy"><span>DPI</span><strong>{dpi}</strong><small>{isApplyingDpi ? "Applying to mouse…" : "Hardware sensitivity"}</small></div><input aria-label="DPI" type="range" min="50" max="26000" step="50" value={dpi} onChange={(event) => void applyDpi(Number(event.target.value))} /></div>
            <div className="setting-card panel"><div className="setting-icon"><Zap size={19} /></div><div className="setting-copy"><span>Polling rate</span><strong>{polling}</strong><small>USB report rate</small></div><div className="segmented">{["125 Hz", "500 Hz", "1000 Hz"].map((rate) => <button className={polling === rate ? "selected" : ""} key={rate} onClick={() => setPolling(rate)} type="button">{rate.replace(" Hz", "")}</button>)}</div></div>
            <div className="setting-card panel"><div className="setting-icon"><Keyboard size={19} /></div><div className="setting-copy"><span>Button layout</span><strong>5 buttons</strong><small>Ready to customise</small></div><button className="secondary-button" onClick={() => setTab("buttons")} type="button">Configure</button></div>
          </section>
        </>}

        {tab === "buttons" && <section className="panel page-panel"><div className="section-heading compact"><div><h2>Button mapping</h2><p>Choose an action for each mouse button.</p></div></div><div className="button-map-grid">{Object.entries(buttonActions).map(([button, action]) => <label className="map-row" key={button}><span className="button-key">{button.replace("Button ", "M")}</span><span>{button}</span><select value={action} onChange={(event) => setButtonActions((current) => ({ ...current, [button]: event.target.value }))}>{actions.map((item) => <option key={item}>{item}</option>)}</select></label>)}</div></section>}

        {tab === "performance" && <section className="panel page-panel"><div className="section-heading compact"><div><h2>Performance</h2><p>Fine-tune sensitivity and responsiveness.</p></div></div><div className="performance-layout"><div className="performance-value"><span>Current DPI</span><strong>{dpi}</strong><small>{isApplyingDpi ? "Applying…" : "Hardware DPI"}</small></div><input className="big-range" aria-label="DPI performance" type="range" min="50" max="26000" step="50" value={dpi} onChange={(event) => void applyDpi(Number(event.target.value))} /></div><div className="polling-options"><span>Polling rate</span>{["125 Hz", "500 Hz", "1000 Hz"].map((rate) => <button className={polling === rate ? "selected" : ""} key={rate} onClick={() => setPolling(rate)} type="button">{rate}</button>)}</div></section>}

        {tab === "profiles" && <section className="panel page-panel"><div className="section-heading compact"><div><h2>Profiles</h2><p>Switch between configurations without losing your settings.</p></div></div><div className="profile-grid">{["Default", "Gaming", "FPS", "Custom"].map((item) => <button key={item} className={`profile-card ${profile === item ? "selected" : ""}`} onClick={() => setProfile(item)} type="button"><Gamepad2 size={19} /><strong>{item}</strong><span>{item === profile ? "Active profile" : "Click to activate"}</span></button>)}</div></section>}

        {tab === "settings" && <section className="panel page-panel"><div className="section-heading compact"><div><h2>Application settings</h2><p>Control how Unnamed behaves on your desktop.</p></div></div><label className="toggle-row"><span><strong>Show other connected mouse devices</strong><small>Include generic pointing devices in detection.</small></span><input checked={showOtherDevices} onChange={(event) => setShowOtherDevices(event.target.checked)} type="checkbox" /></label><label className="toggle-row"><span><strong>Start with Windows</strong><small>Launch Unnamed when you sign in.</small></span><input type="checkbox" /></label><label className="toggle-row"><span><strong>Minimise to tray</strong><small>Keep the app running when the window is closed.</small></span><input type="checkbox" defaultChecked /></label></section>}
      </main>
    </div>
  );
}
