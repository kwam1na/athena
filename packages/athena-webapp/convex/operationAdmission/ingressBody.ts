/**
 * Bounded reading of an HTTP ingress body.
 *
 * The rail reads the body once, before the handler, so an origin or signature
 * verifier covers precisely the bytes the handler goes on to parse. That read
 * waits for the stream to end, which on an unauthenticated route means a slow
 * or endless body can pin the request — so the read has to be bounded, and it
 * has to be bounded BEFORE admission, or an oversize request leaves an
 * admission row behind it.
 *
 * This lives in the rail core because every admitted `http` write needs it,
 * not just the routes whose authors remembered to add middleware. Two
 * marketing routes originally carried their own `boundRequestBody` middleware;
 * that covered the two routes someone thought about, and left the other
 * forty-plus unbounded.
 */

/** Bytes an admitted HTTP write body may carry when a route states no limit. */
export const DEFAULT_INGRESS_MAX_BODY_BYTES = 1_048_576; // 1 MiB

export type BoundedBodyResult =
  | { kind: "ok"; bytes: Uint8Array }
  | { kind: "too_large" };

/**
 * Stream `request`'s body, cancelling the reader the moment `maxBytes` is
 * crossed. Returns the accepted bytes, or `too_large` — never a partial body
 * presented as complete.
 */
export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  // A spent stream yields `{done: true}` on the first read, so a body that was
  // already consumed upstream would silently arrive here as an empty one —
  // and an empty body passes through a signature verifier as a mismatch, not
  // as an error, denying every genuine webhook with no clue why. Middleware
  // that reads the body must hand back a reconstructed request (see
  // `requestWithBody`); failing to is a wiring bug, so say so.
  if (request.bodyUsed) {
    throw new Error(
      "Ingress body was already consumed before admission. Middleware that reads the body must reconstruct the request with requestWithBody() before calling next().",
    );
  }

  const reader = request.body?.getReader();
  if (!reader) return { kind: "ok", bytes: new Uint8Array() };

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("request body exceeds limit");
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", bytes };
}

/**
 * Replace a spent request with one carrying exactly the bytes we accepted.
 *
 * The original stream is consumed by the bounded read, so anything downstream
 * that re-reads it would fail.
 */
export function requestWithBody(request: Request, bytes: Uint8Array): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body:
      bytes.byteLength > 0
        ? (bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer)
        : undefined,
  });
}
