import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

type MouseDevice = {
  id: string;
  name: string;
  manufacturer: string | null;
  vid: string | null;
  pid: string | null;
  connection: string;
  connected: boolean;
};

export default function App() {
  const [profile, setProfile] = useState("Default");
  const [mice, setMice] = useState<MouseDevice[]>([]);
  const [showOtherDevices, setShowOtherDevices] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const detectedMice = await invoke<MouseDevice[]>("detect_mice", {
        showHidden: showOtherDevices,
      });
      setMice(detectedMice);
    } catch (reason) {
      setMice([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  }, [showOtherDevices]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  return (
    <main style={{ maxWidth: 760, padding: 32, fontFamily: "Arial, sans-serif" }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ marginBottom: 8 }}>Unnamed Desktop App</h1>
        <p style={{ color: "#bdbdbd", margin: 0 }}>Mouse configuration utility</p>
      </header>

      <section aria-labelledby="detected-mice-heading">
        <div style={{ alignItems: "center", display: "flex", gap: 16, justifyContent: "space-between" }}>
          <div>
            <h2 id="detected-mice-heading" style={{ marginBottom: 4 }}>Connected mice</h2>
            <p style={{ color: "#bdbdbd", marginTop: 0 }}>
              {showOtherDevices ? "All connected mouse devices" : "Recognised gaming and branded mice"}
            </p>
          </div>
          <button disabled={isLoading} onClick={() => void refreshDevices()} type="button">
            {isLoading ? "Scanning…" : "Refresh devices"}
          </button>
        </div>

        <label style={{ display: "block", margin: "16px 0 20px" }}>
          <input
            checked={showOtherDevices}
            onChange={(event) => setShowOtherDevices(event.target.checked)}
            type="checkbox"
          />{" "}
          Show other connected mouse devices
        </label>

        {error && <p role="alert">Couldn&apos;t scan for mice: {error}</p>}

        {!error && !isLoading && mice.length === 0 && (
          <p>
            No recognised mouse was found. Turn on &ldquo;Show other connected mouse devices&rdquo; if your mouse is not listed yet.
          </p>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {mice.map((mouse) => (
            <article
              key={mouse.id}
              style={{ background: "#1b1b1b", border: "1px solid #353535", borderRadius: 10, padding: 20 }}
            >
              <div style={{ alignItems: "center", display: "flex", gap: 10, justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>🖱 {mouse.name}</h3>
                <span style={{ color: mouse.connected ? "#71d88b" : "#ff8b8b" }}>
                  {mouse.connected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <dl style={{ display: "grid", gap: 8, gridTemplateColumns: "130px 1fr", marginBottom: 0 }}>
                {mouse.manufacturer && <><dt>Manufacturer</dt><dd>{mouse.manufacturer}</dd></>}
                <dt>Connection</dt><dd>{mouse.connection}</dd>
                {mouse.vid && <><dt>VID</dt><dd>{mouse.vid}</dd></>}
                {mouse.pid && <><dt>PID</dt><dd>{mouse.pid}</dd></>}
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section style={{ borderTop: "1px solid #353535", marginTop: 32, paddingTop: 24 }}>
        <strong>Profile: {profile}</strong>{" "}
        <button onClick={() => setProfile("Gaming")} type="button">Switch</button>
      </section>
    </main>
  );
}
