import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./index.css";
import {
  registerPosAppShellServiceWorker,
  unregisterPosAppShellServiceWorkerForDev,
} from "./offline/registerPosAppShellServiceWorker";
import { removeConvexAuthCodeParamFromUrl } from "./auth/convexAuthUrl";
import { initializeAthenaTheme } from "./lib/theme";
import { installPosBrowserErrorCapture } from "./lib/pos/infrastructure/telemetry/browserErrorCapture";
import { enqueuePosClientEvent } from "./lib/pos/infrastructure/telemetry/telemetryBuffer";

const rootElement = document.getElementById("app")!;

installPosBrowserErrorCapture({
  capture: (report) => {
    enqueuePosClientEvent({
      classification: report.classification,
      error: report.error,
      flow: report.flow,
      operation: report.operation,
      pathname: report.pathname,
      source: report.source,
      metadata: report.metadata,
      level: "error",
    });
  },
});

if (!rootElement.innerHTML) {
  initializeAthenaTheme();
  removeConvexAuthCodeParamFromUrl();
  if (import.meta.env.DEV) {
    unregisterPosAppShellServiceWorkerForDev();
  } else {
    registerPosAppShellServiceWorker();
  }
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
