import type { Context, Next } from "hono";

/**
 * Body size bounds for the public marketing ingress routes.
 *
 * Admission changed where the body is read: the rail reads it once, before the
 * handler, so that an origin or signature verifier covers precisely the bytes
 * the handler goes on to parse. That read is unbounded — it waits for the
 * stream to end — so on an unauthenticated route a slow or endless body would
 * otherwise pin the request. The bound therefore moves in FRONT of the rail, as
 * middleware: it streams the request itself, cancels the reader the moment the
 * limit is crossed, and hands the rail a request whose body is the bytes it
 * already accepted. Running before admission also means an oversize request
 * leaves no admission row behind it.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("request body exceeds limit");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Bounds the request body before the admission wrapper reads it.
 *
 * `resolveMaxBytes` may throw when the route's configuration is invalid; the
 * request is then passed through untouched so the handler can answer with its
 * own configuration response rather than being pre-empted here.
 */
export function boundRequestBody(resolveMaxBytes: () => number) {
  return async (c: Context, next: Next) => {
    let maxBytes: number;
    try {
      maxBytes = resolveMaxBytes();
    } catch {
      return next();
    }

    const bytes = await readBoundedBody(c.req.raw, maxBytes);
    if (bytes === null) {
      return c.json({ error: { code: "request_rejected" } }, 413);
    }

    // Hand the rail a request carrying exactly the bytes we accepted: the
    // original stream is spent, and re-reading it would fail.
    c.req.raw = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers: c.req.raw.headers,
      body:
        bytes.byteLength > 0
          ? (bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer)
          : undefined,
    });

    return next();
  };
}
