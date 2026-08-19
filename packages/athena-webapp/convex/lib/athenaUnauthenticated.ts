/**
 * "There is no Athena identity on this context."
 *
 * A typed absence rather than a message: the admission rail turns this — and
 * only this — into an `unauthenticated` outcome that may fall through to a
 * lower-trust adapter. Every other failure propagates, which is what removes
 * the old catch-all that could re-admit any throw as `public`.
 *
 * It lives in its own module, apart from `athenaUserAuth.ts`, so the class
 * identity survives suites that partially mock the auth module: an
 * `instanceof` check must never depend on whether a test replaced the helpers
 * next to it.
 */
export class AthenaUnauthenticatedError extends Error {
  constructor(message = "Sign in again to continue.") {
    super(message);
    this.name = "AthenaUnauthenticatedError";
  }
}

export function isAthenaUnauthenticatedError(
  error: unknown,
): error is AthenaUnauthenticatedError {
  return error instanceof AthenaUnauthenticatedError;
}
