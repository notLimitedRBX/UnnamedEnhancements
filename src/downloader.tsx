import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./downloader.css";

type DownloadProgress = { percent: number; status: string };

function Downloader() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Preparing download...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    setStatus("Checking for the latest version...");
    void listen<DownloadProgress>("download-progress", event => {
      setProgress(event.payload.percent);
      setStatus(event.payload.status);
    }).then(stop => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("Download unavailable");
    });

    void invoke("download_latest_app")
      .then(() => {
        void getCurrentWindow().close();
      })
      .catch(reason => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("Download unavailable");
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <main className="downloader-screen">
      <section className="download-panel" aria-label="Unnamed Enhancements download progress">
        <h1>Unnamed Enhancements</h1>
        <p>{error ?? status}</p>
        <strong>{progress}%</strong>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Downloader />);
