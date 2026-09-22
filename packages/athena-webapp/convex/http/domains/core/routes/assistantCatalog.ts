import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";

import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";
import { assistantCatalogSearchRouteReadDefinition } from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import { admitHttpRead } from "../../../../platform/operationAdmission";
import { CATALOG_ACCESS_TOKEN_TOUCH_INTERVAL_MS } from "../../../../inventory/catalogAccess";

/**
 * `GET /assistant-catalog/search` — the catalogue read an external assistant
 * makes on behalf of a shopper who is talking to somebody else's front desk.
 *
 * THE QUESTION TRAVELS IN A HEADER, not the query string, and that is the
 * whole shape of this file. The rail spreads the query string into
 * `operationArgs`, which is recorded and logged; a shopper's sentence must
 * not be. So `X-Assistant-Query` is read here, after admission, and only
 * `limit` is ever in the URL.
 *
 * EVERY BOUND IS APPLIED HERE, before the internal query is called, so that
 * query's arguments can stay a plain string and number. A Convex
 * `ArgumentValidationError` prints the offending value, so a validator strict
 * enough to reject a malformed question would be the one thing that writes it
 * into a log line.
 *
 * A query that cannot be read — bad percent-encoding, too many bytes — is not
 * an error to the caller. It is a question with no answer: 200, no matches,
 * `exhaustive: false`. The assistant then says the shop's listing does not
 * cover it, which is true, instead of reporting an outage.
 */
const assistantCatalogRoutes: HonoWithConvex<ActionCtx> = new Hono();

/** Percent-encoded UTF-8: 200 codepoints cannot exceed this raw. */
export const ASSISTANT_QUERY_HEADER_MAX_BYTES = 2_400;
export const ASSISTANT_QUERY_MAX_CODEPOINTS = 200;
export const ASSISTANT_SEARCH_DEFAULT_LIMIT = 5;
export const ASSISTANT_SEARCH_MIN_LIMIT = 1;
export const ASSISTANT_SEARCH_MAX_LIMIT = 10;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const LONE_SURROGATE = /^[\uD800-\uDFFF]$/;

export type AssistantQueryOutcome =
  | { kind: "query"; q: string }
  | { kind: "unreadable" };

/**
 * The asker's text, or the fact that there is none to be had.
 *
 * `undefined` and `""` are both a valid probe: the wire protocol says a
 * present-but-empty query is legal, and an absent one is the same question
 * asked with less ceremony. Neither is an error.
 */
export function resolveAssistantQueryHeader(
  raw: string | undefined,
): AssistantQueryOutcome {
  if (raw === undefined || raw === "") return { kind: "query", q: "" };
  if (new TextEncoder().encode(raw).length > ASSISTANT_QUERY_HEADER_MAX_BYTES) {
    return { kind: "unreadable" };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A `URIError` only ever means the caller sent something this decoder
    // cannot read. It is never retried and never reported.
    return { kind: "unreadable" };
  }

  const collapsed = decoded.replace(CONTROL_CHARACTERS, " ");
  const q = Array.from(collapsed)
    .slice(0, ASSISTANT_QUERY_MAX_CODEPOINTS)
    // A slice can also land between the halves of an astral character, and a
    // half is not text: drop it rather than pass a broken string on.
    .filter((codepoint) => !LONE_SURROGATE.test(codepoint))
    .join("")
    .trim();

  return { kind: "query", q };
}

/** `?limit=abc` is not a request for zero results; it is no request at all. */
export function resolveAssistantSearchLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(parsed)) {
    return ASSISTANT_SEARCH_DEFAULT_LIMIT;
  }
  return Math.min(
    Math.max(ASSISTANT_SEARCH_MIN_LIMIT, Math.trunc(parsed)),
    ASSISTANT_SEARCH_MAX_LIMIT,
  );
}

/**
 * Freshness for the operator who minted the token, at a quarter-hour
 * resolution. The mutation re-checks the interval; this only keeps a busy
 * reader from scheduling a write it knows will be a no-op.
 */
export function shouldStampCatalogAccessToken(
  lastUsedAt: number | undefined,
  now: number,
): boolean {
  if (lastUsedAt === undefined) return true;
  return now - lastUsedAt >= CATALOG_ACCESS_TOKEN_TOUCH_INTERVAL_MS;
}

assistantCatalogRoutes.get(
  "/search",
  admitHttpRead(
    assistantCatalogSearchRouteReadDefinition,
    async (c, { admission }) => {
      // The store comes from the admitted constraint, which the catalogue
      // reader adapter took from the token row. Never the cookie, never an
      // argument: a `?storeId=` naming another store was already refused.
      const storeId = admission.constraints.storeId as Id<"store">;
      const limit = resolveAssistantSearchLimit(c.req.query("limit"));
      const outcome = resolveAssistantQueryHeader(
        c.req.header("X-Assistant-Query"),
      );

      const body = await c.env.runQuery(
        internal.storeFront.assistantCatalog.search,
        {
          limit,
          // An unreadable header searches for nothing, which answers nothing
          // and claims nothing: `exhaustive` comes back false.
          q: outcome.kind === "query" ? outcome.q : "",
          storeId,
        },
      );

      const tokenId = (admission.actor as { tokenId?: Id<"catalogAccessToken"> })
        .tokenId;
      const lastUsedAt = admission.provenance.lastUsedAt;
      if (
        tokenId &&
        shouldStampCatalogAccessToken(
          typeof lastUsedAt === "number" ? lastUsedAt : undefined,
          Date.now(),
        )
      ) {
        try {
          await c.env.runMutation(internal.inventory.catalogAccess.touch, {
            tokenId,
          });
        } catch {
          // The stamp is bookkeeping about the credential; the shopper's
          // answer is already built. A reason code, never the request.
          console.warn("assistant_catalog_token_stamp_failed");
        }
      }

      return c.json(body, 200, { "Cache-Control": "no-store, private" });
    },
  ),
);

export { assistantCatalogRoutes };
