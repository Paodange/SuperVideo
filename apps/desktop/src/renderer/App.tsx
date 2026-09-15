import { useEffect, useState } from "react";
import type { DesktopEnvironment } from "@supervideo/shared";

type EnvironmentState = DesktopEnvironment;

export function App() {
  const [environment, setEnvironment] = useState<EnvironmentState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.supervideo;
    if (!bridge) {
      setEnvironment({ mode: "development", platform: "browser preview", electron: "—" });
      return;
    }

    bridge.getEnvironment().then(setEnvironment).catch(() => setError("Desktop status is unavailable."));
  }, []);

  return (
    <main className="shell">
      <section className="card" aria-labelledby="app-title">
        <div className="eyebrow">LOCAL VIDEO CREATION WORKSPACE</div>
        <h1 id="app-title">SuperVideo</h1>
        <p className="lead">A small, local-first desktop foundation for the video agent.</p>

        <div className="status" aria-live="polite">
          <span className={`status-dot ${error ? "status-dot-error" : ""}`} aria-hidden="true" />
          <span>{error ?? (environment ? "Desktop is ready" : "Checking desktop status…")}</span>
        </div>

        <dl className="details">
          <div>
            <dt>Desktop status</dt>
            <dd>{environment ? "Ready" : "Checking"}</dd>
          </div>
          <div>
            <dt>Development environment</dt>
            <dd>{environment?.mode ?? "development"}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{environment?.platform ?? "Windows target"}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{environment?.electron ?? "—"}</dd>
          </div>
        </dl>

        <p className="scope">A01 scaffold · Renderer, Main, preload, Agent Worker and Python Core are separate modules.</p>
      </section>
    </main>
  );
}
