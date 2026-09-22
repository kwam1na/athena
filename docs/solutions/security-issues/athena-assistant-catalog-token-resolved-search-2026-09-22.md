---
title: A Token-Resolved Catalogue Read For A Caller That Is Not A Person
date: 2026-09-22
category: docs/solutions/security-issues
module: Athena catalogue access tokens, catalogue-reader admission, assistant catalogue endpoint
problem_type: security_issue
component: authentication
symptoms:
  - "An external assistant needs shop data, and the only credentials on hand belong to operators"
  - "A shopper's question would be recorded in `operationArgs` and in URL logs if it travelled in the query string"
  - "A search that can match on barcodes lets a caller confirm a barcode it merely guessed"
  - "A rejected credential that falls through to the anonymous adapter still reads whatever anonymous callers may read"
root_cause: missing_permission
resolution_type: code_fix
severity: critical
tags: [athena, convex, catalogue, bearer-token, operation-admission, projection, search-index]
delivery_diff_fingerprint: 21ea79953bbd4f84b101c9da949be06f0c927953c24063981a160a567fe5e1a6
---

# A Token-Resolved Catalogue Read For A Caller That Is Not A Person

## Problem

A store wanted an external front-desk assistant to answer "do you have a
burgundy bob wig?" from the real catalogue. Nothing in Athena could serve that.
Every credential belonged to an operator, every catalogue read was shaped for a
browser, and the only search index over the catalogue contained barcodes, cost
bases and invisible rows.

Three separate things had to be true at once, and each of them fails silently
if it is assumed rather than built:

1. The shop can hand out a credential and take it back without touching anyone's
   account, and the platform can never re-display it.
2. The credential — not a cookie, not an argument — decides which store is read.
3. Nothing the shop keeps to itself can be confirmed through the endpoint, in
   the body **or** through a ranking, a `hasMore` or an `exhaustive`.

## Symptoms

- No credential existed that a store could issue to a program and revoke alone.
- The catalogue search index (`searchText`) contains `barcode`, `unitCost`
  neighbours and draft/hidden rows, so any endpoint reading it could confirm a
  guessed barcode by whether the ranking moved.
- The rail spreads the whole query string into `operationArgs`
  (`rail.ts` `requestArgs`), so a question sent as `?q=` is recorded.
- Convex `ArgumentValidationError` prints the offending value, so a strict
  validator on the question is itself a way to write the question into a log.

## What Didn't Work

- **A derived grant instead of an actor kind.** The existing doctrine note says
  "add a caller kind by giving it a derived grant, not by adding an actor kind."
  That rule was written for *delegated* callers — a program acting for a signed-in
  operator. This caller presents its own credential and acts for itself, which is
  ingress identity in the same sense as the storefront cookie claim. The doctrine
  note is amended in the same change to scope its bullet to delegated callers.
- **Reusing `searchProductSkus`.** It resolves a SKU the staff already hold: by
  document id, by barcode, by anything on the row. Filtering its results would
  have left the *ranking* computed over private data. The fix had to change what
  enters the candidate set, not what leaves it.
- **A stale-cookie-style `not_applicable` for a rejected token.** The storefront
  adapter treats an unrecognised cookie as "not my caller" and lets the request
  continue anonymously. A token in a header was chosen and sent, so the same
  treatment would let a withdrawn credential keep reading whatever anonymous
  callers may read.

## Solution

Four pieces, each doing one job.

**A hashed bearer credential per store** (`convex/inventory/catalogAccess.ts`,
`schemas/inventory/catalogAccessToken.ts`). 32 CSPRNG bytes, base64url, prefixed
`athcat_`. Only the lowercase-hex SHA-256 of the exact header value is stored;
the raw value exists solely in the mint response and every listing projection
omits `tokenHash`. At most five active per store; revoke is by id, and because a
store scope only echoes `args.storeId`, the handler compares the target row's own
`storeId` against `ctx.operationAdmission.constraints.storeId` and raises
`operationAdmissionDenial({ reason: "scope_denied" })`. Authorization is
two-layered: the rail clamps the claimed store, the handler then resolves that
store's organization and requires `full_admin` membership there.

**Hash at ingress, decide in the adapter** (`http/utils.ts`,
`convex/inventory/catalogAccessAdapter.ts`). The ingress claim extractor
pattern-checks `X-Assistant-Token` and hashes it synchronously; it verifies
nothing, and a non-matching value is never hashed. The adapter reads only that
field. Absent → `not_applicable`. Present on a definition that denies the kind →
terminal `denied` **before any lookup**. Otherwise it looks the hash up, requires
`status: "active"`, takes the store from the token row, cross-checks a `storeId`
argument against it, and carries `lastUsedAt` in `provenance` so the handler
needs no second read. Which adapter refused travels as typed data
(`decision.adapter`), so one caller kind can get its own refusal body without
classifying message text.

**An index that never held the private fields**
(`convex/inventory/skuSearch.ts`, `schema.ts`). The projection gains
`assistantSearchText` (built with `includeBarcode: false`, and with the SKU code
dropped too when the code equals the barcode — the importer default) and
`assistantVisible` (composite storefront visibility computed through the shared
helpers). A second search index `assistant_search` filters on `storeId` and
`assistantVisible`. Both fields are `v.optional` so the schema pushes before the
backfill.

**A route where every bound is applied before the query runs**
(`http/domains/core/routes/assistantCatalog.ts`,
`convex/storeFront/assistantCatalog.ts`). The question travels in
`X-Assistant-Query`; the URL carries `limit` and nothing else. The route bounds
the raw header to 2,400 bytes, decodes it inside a `try`, collapses control
characters, slices to 200 codepoints and drops lone surrogates — so the internal
query's args stay `v.string()` / `v.number()` and no validator can echo the text.
An unreadable header is answered, not reported: 200, no matches,
`exhaustive: false`. The response is a closed `assistant_catalog.v1` validator
served with `Cache-Control: no-store, private`.

## Why This Works

**The private data is not filtered out; it was never in.** The assistant's
candidate set comes from an index built without barcodes and filtered to visible
rows, so a real barcode and a made-up one produce identical matches, ranking,
`hasMore` and `exhaustive`. A hidden SKU's code answers exactly as a code that
never existed. That is a property of the index, not of a projection step someone
can forget to apply — which is why the closed response validator is described as
the *contract* rather than the privacy control.

**"Exhaustive" means a search happened.** Convex text search is an OR over
tokens, so "do you have any of the" would match the whole shop and then claim to
have covered it. Tokens of two characters or fewer and a short stop list are
dropped, and a question with nothing left is not a search: no matches,
`exhaustive: false`. `exhaustive` is otherwise `!candidateOverflow` over the
remaining tokens.

**Reads write nothing — except about themselves.** `lastUsedAt` is stamped after
the response is built, in a `try/catch`, at most once a quarter hour, through a
mutation whose only argument is the token id. The question is never written. The
precedent is `GET /storefront`, which mints a guest inside an `admitHttpRead`;
both are documented on the definition and in the rail's header comment so "a
read writes nothing" is not quietly false.

**Grouping before hydrating keeps the read cost flat.** A candidate row already
names its product, so the search reserves the match slots from the index rows and
hydrates only the SKUs that can appear in the answer — a question that overflows
the 61-row text window still costs the hydration of at most `limit` products.

## Prevention

- **A presented credential is recognised identity.** A route that denies the
  kind must refuse terminally, before any lookup. Falling through to the
  anonymous adapter is how a withdrawn credential keeps working.
- **A store scope does not bind a row.** `resolveOperationScope` only echoes
  `args.storeId`. Any handler mutating a row addressed by id must compare the
  row's own `storeId` against the admitted constraint. Test: admit on store B,
  pass store A's id, assert the row is unchanged.
- **Caller-supplied free text belongs in a header, and its bounds belong in the
  route.** The rail records the query string; a Convex validator error prints the
  value it rejected. Both are avoided only by bounding before the call.
- **When a caller can only be refused or served, one refusal body per caller
  kind, chosen by typed data.** `CATALOG_READER_REJECTION_BODY` is emitted by the
  rail for any `catalog_reader` denial, keyed on `decision.adapter` — never on
  message text.
- **Coverage is stated, never defaulted.** `requireValidReadDefinition` runs per
  request, so a validator newly requiring `actors.catalogReader` and the helpers
  supplying it must land in the same commit.
- **A lint, not a memory, keeps a header out of the logs.**
  `convex/http/domains/core/routes/assistantHeaderLogging.test.ts` scans every
  Convex source for a `console.*` argument naming an assistant header, and proves
  the scanner bites by running it over a violating snippet.
- **Adding a Convex module moves generated harness docs.** `bun run
  harness:generate` is part of the change, as is
  `bun scripts/convex-operation-admission-check.ts --callers --downstream-writes`.

## Deploy and backfill checklist

Order matters: **deploy → backfill → mint.** Between deploy and backfill the two
projection fields are absent on existing rows, so the index is incomplete and
`exhaustive` is unreliable; a token minted in that window would let the assistant
claim it had covered a catalogue it had not. Athena has one store, so the window
is closed by hand.

1. Deploy (`scripts/deploy-vps.sh`). The schema pushes because both new
   projection fields are `v.optional`.
2. Run the backfill dry run, then apply it, then verify the count. The exact
   `bunx convex run` commands — cursor/limit/`dryRun` shape, the apply call and
   the count query that compares `productSkuSearch` rows carrying
   `assistantSearchText` against the store's `productSku` rows — are in
   [optional projection fields and a hand-run backfill](../architecture-patterns/athena-optional-projection-fields-and-hand-run-backfill-2026-09-22.md).
   Do not duplicate them here; run them from that note.
3. Only once the count query reports rows-with-field = SKU rows, mint the store's
   token from the store-configuration view and hand the raw value over. It is
   shown once.

Revoking is the inverse and needs no deploy: the next call answers 403 with the
rejection body.

## Related Issues

- [Answering a caller that is not a person](../architecture-patterns/athena-answering-a-non-human-caller-2026-08-22.md)
  — the delegated-caller doctrine, whose "derived grant, not an actor kind"
  bullet this change scopes to delegated callers.
- [Optional projection fields and a hand-run backfill](../architecture-patterns/athena-optional-projection-fields-and-hand-run-backfill-2026-09-22.md)
  — why both fields are optional, and the backfill commands.
- Linear: V26-2095 (token), V26-2096 (index and backfill), V26-2097 (actor kind,
  claim and adapter), V26-2098 (endpoint and projection).
