export type PublicLandingFunnelEvent =
  | "page_view"
  | "walkthrough_cta"
  | "form_start";

const emittedEvents = new Set<PublicLandingFunnelEvent>();
type FunnelFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function coarseDevice(): "mobile" | "tablet" | "desktop" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  if (window.innerWidth < 640) return "mobile";
  if (window.innerWidth < 1024) return "tablet";
  return "desktop";
}

export function resetLandingFunnelDedupeForTests() {
  emittedEvents.clear();
}

export function emitLandingFunnelEvent(
  event: PublicLandingFunnelEvent,
  options: { apiGatewayUrl?: string; fetchImpl?: FunnelFetch } = {},
) {
  if (emittedEvents.has(event)) return false;
  emittedEvents.add(event);

  const base = (
    options.apiGatewayUrl ?? import.meta.env.VITE_API_GATEWAY_URL ?? ""
  ).trim().replace(/\/+$/, "");
  if (!base) return false;

  const fetchImpl = options.fetchImpl ?? fetch;
  void fetchImpl(`${base}/marketing/funnel-events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event,
      device: coarseDevice(),
      source: "unknown",
    }),
    keepalive: true,
  }).catch(() => undefined);
  return true;
}
