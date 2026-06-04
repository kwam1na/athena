const POS_APP_SHELL_SERVICE_WORKER_URL = "/pos-app-shell-sw.js";

let registrationStarted = false;

export function registerPosAppShellServiceWorker(win: Window = window): void {
  if (registrationStarted) return;
  if (!("serviceWorker" in win.navigator)) return;

  registrationStarted = true;

  win.navigator.serviceWorker
    .register(POS_APP_SHELL_SERVICE_WORKER_URL, { scope: "/" })
    .catch((error: unknown) => {
      registrationStarted = false;
      console.warn("POS offline app shell is not available.", error);
    });
}

export function resetPosAppShellServiceWorkerRegistrationForTest(): void {
  registrationStarted = false;
}
