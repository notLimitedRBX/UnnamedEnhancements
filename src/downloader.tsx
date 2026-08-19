import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./downloader.css";

function Downloader() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress(value => value >= 68 ? 68 : value + 1);
    }, 24);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="downloader-screen">
      <section className="download-panel" aria-label="Unnamed Enhancements download progress">
        <h1>Unnamed Enhancements</h1>
        <p>Downloading...</p>
        <strong>{progress}%</strong>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Downloader />);
