export const WALKTHROUGH_REQUEST_PATH = "/marketing/walkthrough-requests";

export type WalkthroughRequestPayload = {
  name: string;
  workEmail: string;
  businessName: string;
  phone?: string;
  businessNeed: string;
};

export type WalkthroughRequestInput = WalkthroughRequestPayload & {
  submissionKey: string;
  website: string;
};

export type WalkthroughRequestResult =
  | { kind: "accepted" }
  | { kind: "retry_required" | "temporarily_unavailable" | "request_rejected" };

type FetchRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function canonicalizeWalkthroughPayload(
  payload: WalkthroughRequestPayload,
) {
  return JSON.stringify({
    name: normalizeWalkthroughText(payload.name),
    workEmail: normalizeWalkthroughEmail(payload.workEmail),
    businessName: normalizeWalkthroughText(payload.businessName),
    phone: normalizeWalkthroughText(payload.phone ?? "") || undefined,
    businessNeed: normalizeWalkthroughText(payload.businessNeed),
  });
}

export function normalizeWalkthroughText(value: string) {
  return stripControlCharacters(value).replace(/\s+/g, " ").trim();
}

export function normalizeWalkthroughEmail(value: string) {
  return stripControlCharacters(value).replace(/\s+/g, "").toLowerCase();
}

function stripControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");
}

function generateSubmissionKey() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }

  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Keeps one browser-generated identity attached to one canonical payload.
 * The identity rotates as soon as an attempted payload is edited.
 */
export class WalkthroughSubmissionIdentity {
  private canonicalPayload = "";
  private key: string;
  private attempted = false;

  constructor(private readonly keyFactory = generateSubmissionKey) {
    this.key = keyFactory();
  }

  notePayloadChange(payload: WalkthroughRequestPayload) {
    const canonicalPayload = canonicalizeWalkthroughPayload(payload);

    if (this.attempted && canonicalPayload !== this.canonicalPayload) {
      this.key = this.keyFactory();
      this.attempted = false;
    }

    this.canonicalPayload = canonicalPayload;
  }

  beginAttempt(payload: WalkthroughRequestPayload) {
    this.notePayloadChange(payload);
    this.attempted = true;
    return this.key;
  }

  rotateForRetry(payload: WalkthroughRequestPayload) {
    this.key = this.keyFactory();
    this.canonicalPayload = canonicalizeWalkthroughPayload(payload);
    this.attempted = false;
  }
}

export function resolveWalkthroughRequestUrl(apiGatewayUrl: string) {
  const base = apiGatewayUrl.trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("Walkthrough requests are not configured.");
  }
  return `${base}${WALKTHROUGH_REQUEST_PATH}`;
}

export async function submitWalkthroughRequest(
  input: WalkthroughRequestInput,
  options: {
    apiGatewayUrl?: string;
    fetchImpl?: FetchRequest;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<WalkthroughRequestResult> {
  if (options.signal?.aborted) {
    return { kind: "temporarily_unavailable" };
  }
  const apiGatewayUrl =
    options.apiGatewayUrl ?? import.meta.env.VITE_API_GATEWAY_URL ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000,
  );
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetchImpl(resolveWalkthroughRequestUrl(apiGatewayUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    const body: unknown = await response.json();
    if (
      response.ok &&
      body !== null &&
      typeof body === "object" &&
      "accepted" in body &&
      body.accepted === true
    ) {
      return { kind: "accepted" };
    }

    const code = readPublicErrorCode(body);
    if (code === "retry_required") return { kind: "retry_required" };
    if (code === "request_rejected") return { kind: "request_rejected" };
    return { kind: "temporarily_unavailable" };
  } catch {
    return { kind: "temporarily_unavailable" };
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function readPublicErrorCode(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = body.error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
