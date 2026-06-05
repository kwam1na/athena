export function removeConvexAuthCodeParamFromUrl(win: Window = window) {
  const url = new URL(win.location.href);

  if (!url.searchParams.has("code")) {
    return false;
  }

  url.searchParams.delete("code");
  const sanitizedPath = `${url.pathname}${url.search}${url.hash}`;
  win.history.replaceState(win.history.state, "", sanitizedPath);

  return true;
}
