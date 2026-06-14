const POS_APP_SHELL_SERVICE_WORKER_URL = "/pos-app-shell-sw.js";
export const POS_APP_SHELL_CACHE_PREFIX = "athena-pos-app-shell-";

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

export function unregisterPosAppShellServiceWorkerForDev(
  win: Window = window,
): void {
  registrationStarted = false;

  if ("serviceWorker" in win.navigator) {
    void win.navigator.serviceWorker.getRegistrations?.().then((registrations) =>
      Promise.all(
        registrations
          .filter((registration) =>
            isPosAppShellServiceWorkerRegistration(registration, win),
          )
          .map((registration) => registration.unregister()),
      ),
    );
  }

  if ("caches" in win) {
    void win.caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(POS_APP_SHELL_CACHE_PREFIX))
          .map((key) => win.caches.delete(key)),
      ),
    );
  }
}

function isPosAppShellServiceWorkerRegistration(
  registration: ServiceWorkerRegistration,
  win: Window,
) {
  const scriptUrl =
    registration.active?.scriptURL ??
    registration.waiting?.scriptURL ??
    registration.installing?.scriptURL;
  if (!scriptUrl) return false;

  return (
    new URL(scriptUrl, win.location.href).pathname ===
    POS_APP_SHELL_SERVICE_WORKER_URL
  );
}
