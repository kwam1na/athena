import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./index.css";
import {
  registerPosAppShellServiceWorker,
  unregisterPosAppShellServiceWorkerForDev,
} from "./offline/registerPosAppShellServiceWorker";
import { removeConvexAuthCodeParamFromUrl } from "./auth/convexAuthUrl";
import { initializeAthenaTheme } from "./lib/theme";

const rootElement = document.getElementById("app")!;

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
