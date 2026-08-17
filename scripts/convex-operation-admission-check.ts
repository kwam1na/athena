/**
 * Structural admission sensor for the complete backend boundary.
 *
 * Discovers EVERY backend ingress under `packages/athena-webapp/convex/**` —
 * exported public `mutation` / `query` / `action`, destructured framework
 * registrar exports (`convexAuth`), and every Hono route registration form —
 * and requires each one to be covered by an operation definition AND routed
 * through one of the five canonical wrappers exported by the composition root
 * `convex/platform/operationAdmission.ts`.
 *
 * There is no exemption or inventory concept. The only ingress allowed to be
 * unadmitted is a framework-generated one named in `FRAMEWORK_ENTRY_POINTS`
 * with a reason, and that list is verified in both directions.
 *
 * Admission is recognized by a CLOSED GRAMMAR — see `ACCEPTED_WRAPPER_SHAPES`
 * and the "Wrapper grammar" section below. Three consecutive review rounds
 * defeated the blacklist this replaced, so the rule is now "exactly these three
 * spellings, and the wrapper's import specifier RESOLVES to
 * `convex/platform/operationAdmission.ts`". Everything else raises
 * `wrapper-shape`.
 *
 * The same inversion applies to everything AROUND the grammar (round 4):
 * discovery of exported functions, Hono route discovery, the definition
 * argument's identity, the `api.*` ban's roots, and the CORS assertion are each
 * a whitelist of resolvable spellings with a fail-closed finding for the rest
 * (`ingress-not-statically-resolvable`,
 * `route-registration-not-statically-resolvable`,
 * `admission-definition-does-not-name-this-ingress`,
 * `admission-definition-not-statically-resolvable`). Nothing the checker
 * cannot follow is a pass.
 *
 * Round 5 closed the INPUTS to those whitelists: the module set is exactly the
 * bundler's entry points (every entry-point extension, only the top-level
 * `_generated/` skipped); the builder and `api` imports are matched by
 * RESOLVING the specifier, never by a suffix regex; a builder rebound,
 * re-exported, or reassigned is unresolvable; the definition handed to a
 * wrapper must BE the registered object (`admission-definition-not-registered`);
 * a route on an unresolved receiver is flagged for any string path; the CORS
 * count sees every spelling that resolves to `hono/cors`, in every module
 * (`cors-middleware-outside-router-module`); and the `api.*` ban scans string,
 * symbol-keyed, and import-rooted function references in modules that never
 * import `api`.
 *
 * Round 6 closed the edges of round 5: a route on a top-level alias /
 * container of an imported router is resolved through the declaration
 * initializer (any path on a module-scoped unresolvable receiver is a route);
 * definition identity is instance identity only (no structural fallback —
 * function-valued policy cannot be compared); `internal`-rooted references
 * are enumerated to `a/b:c` against the public set (`internal` IS `anyApi`);
 * `httpAction` / `httpActionGeneric` are builders with no admitted shape and
 * `.route(<single non-string>)` is flagged on any receiver; the external
 * re-export scan follows plain relative imports; and `await import()` /
 * `require()` / `import x = require()` of the builder modules or `hono/cors`
 * fail closed.
 *
 * Round 7 replaced the two remaining CALL grammars with VALUE rules, the
 * design that has kept surviving review (it is how builder discovery has
 * worked since round 4): the router reference sweep flags any value reference
 * to a router (local or import-resolved) outside the accepted positions;
 * `isUnresolvableReceiver` defaults to unresolvable; any value reference to
 * an `api` root anywhere is a site; `internal` is widened like `api` but fails
 * closed on loss of path; run sites are matched by callee NAME in every shape
 * (bracket, `.call` / `.apply` / `Reflect.apply`, a bound identifier); the
 * CORS assertion fails on an opaque dynamic specifier or a tsconfig-alias
 * import in a router module; tsconfig `paths` aliases are resolved AND
 * reported; and definition modules may not read the environment
 * (`definition-module-reads-environment`).
 *
 * Flags:
 *   --path <prefix...>    restrict findings to convex-relative path prefixes
 *   --partition           print the per-unit ownership table; fail on orphans
 *   --callers             write docs/plans/2026-08-16-002-backend-caller-table.md
 *   --downstream-writes   write docs/plans/2026-08-16-002-downstream-writes.md
 */
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export type OperationAdmissionSeverity = "high" | "medium" | "low";

export type IngressKind =
  | "mutation"
  | "query"
  | "action"
  | "http"
  | "http_read"
  | "registrar";

export type IngressRegistration = {
  /** `module:export` for Convex functions, `METHOD path` for routes. */
  id: string;
  kind: IngressKind;
  filePath: string;
  line: number;
  moduleName: string;
  exportName?: string;
  route?: { method: string; path: string };
  /** Canonical wrapper recognized on this ingress, when any. */
  wrapper?: string;
  admitted: boolean;
  /** `true` when the wrapper name was recognized but imported elsewhere. */
  wrapperOffComposition?: boolean;

  /**
   * Why the handler was rejected by the wrapper grammar, when a canonical
   * wrapper appears in it but not in one of the accepted shapes. Absent when
   * the handler is admitted AND when no wrapper appears at all — those are
   * different remediations and raise different findings.
   */
  wrapperShape?: string;

  /**
   * The definition expression handed to the wrapper, as a root identifier plus
   * the property path off it (`a.b.c` -> root `a`, path `["b", "c"]`). Present
   * on every admitted ingress; the main check resolves it through the module's
   * imports and requires the definition it denotes to name THIS ingress.
   */
  definitionReference?: DefinitionReference;

  /**
   * Set when an exported binding references a registration builder but is not
   * spelled in a shape discovery can resolve. Such an entry is never admitted:
   * an unknown spelling is a failure, not a pass.
   */
  notStaticallyResolvable?: string;
};

export type DefinitionReference = {
  root: string;
  path: string[];
};

export type OperationAdmissionDefinition = {
  kind?: string;
  operationId?: string;
  functionName?: string;
  route?: { method?: string; path?: string };
  capability?: unknown;
  access?: { intent?: string; kind?: string };
  actors?: Record<string, string | undefined>;
};

export type OperationAdmissionFinding = {
  id: string;
  severity: OperationAdmissionSeverity;
  title: string;
  filePath: string;
  line?: number;
  functionName?: string;
  rationale: string;
  remediation: string;
};

export type CallerTableRow = {
  ingressId: string;
  ingressKind: IngressKind;
  filePath: string;
  line: number;
  callee: string;
  calleeRoot: "api" | "internal";
  idArgs: { name: string; source: "client-supplied" | "admitted-actor" }[];
  disposition:
    | "internalize"
    | "keep-public+internal-sibling"
    | "already-internal";
};

export type DownstreamWriteRow = {
  ingressId: string;
  ingressKind: IngressKind;
  operationId: string;
  internalMutation: string;
  depth: number;
};

export type PartitionUnitReport = {
  unit: string;
  files: number;
  mutations: number;
  queries: number;
  actions: number;
  routes: number;
  rawMutations: number;
  rawQueries: number;
  rawActions: number;
  rawRoutes: number;
  admitted: number;
  raw: number;
};

export type OperationAdmissionCheckResult = {
  ingress: IngressRegistration[];
  admitted: IngressRegistration[];
  raw: IngressRegistration[];
  findings: OperationAdmissionFinding[];
  partition: PartitionUnitReport[];
  orphanFiles: string[];
  callerTable: CallerTableRow[];
  downstreamWrites: DownstreamWriteRow[];
};

type CheckOptions = {
  operationDefinitions?: readonly OperationAdmissionDefinition[];
  readDefinitions?: readonly OperationAdmissionDefinition[];
  /** Convex-relative path prefixes; findings outside them are dropped. */
  paths?: readonly string[];
};

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

const CONVEX_ROOT_RELATIVE = "packages/athena-webapp/convex";

/** The five canonical wrappers and the ingress kind each one admits. */
export const CANONICAL_WRAPPERS: Readonly<Record<string, IngressKind>> = {
  admitPublicMutation: "mutation",
  admitPublicQuery: "query",
  admitPublicAction: "action",
  admitHttpRoute: "http",
  admitHttpRead: "http_read",
};

export type FrameworkEntryPoint = {
  id: string;
  kind: "registrar" | "http_family";
  filePath: string;
  reason: string;
};

/**
 * The complete set of ingress the rail does not admit, each named honestly.
 *
 * `convexAuth` is the trust root: it MINTS the principals the adapters later
 * resolve, so it cannot itself be admitted by them. Its registrar exports and
 * the HTTP route family it installs are the only non-admitted ingress.
 */
export const FRAMEWORK_ENTRY_POINTS: readonly FrameworkEntryPoint[] = [
  {
    id: "auth:auth",
    kind: "registrar",
    filePath: `${CONVEX_ROOT_RELATIVE}/auth.ts`,
    reason:
      "Convex Auth registrar export. The auth object is the trust root that mints principals; admission adapters resolve the actors it creates.",
  },
  {
    id: "auth:signIn",
    kind: "registrar",
    filePath: `${CONVEX_ROOT_RELATIVE}/auth.ts`,
    reason:
      "Convex Auth registrar export. Sign-in runs before any Athena identity exists, so there is no actor to admit.",
  },
  {
    id: "auth:signOut",
    kind: "registrar",
    filePath: `${CONVEX_ROOT_RELATIVE}/auth.ts`,
    reason:
      "Convex Auth registrar export. Sign-out tears the principal down; denying it would strand sessions.",
  },
  {
    id: "auth:store",
    kind: "registrar",
    filePath: `${CONVEX_ROOT_RELATIVE}/auth.ts`,
    reason:
      "Convex Auth registrar export. The framework calls it internally during principal minting.",
  },
  {
    id: "auth.addHttpRoutes",
    kind: "http_family",
    filePath: `${CONVEX_ROOT_RELATIVE}/http.ts`,
    reason:
      "Convex Auth installs its own HTTP route family. It is registered exactly once, from http.ts, before the CORS middleware, and is outside the rail by design.",
  },
];

type UnitOwnership = {
  unit: string;
  /** Convex-relative file paths owned outright. */
  files?: readonly string[];
  /** Convex-relative directory prefixes owned outright. */
  prefixes?: readonly string[];
};

/**
 * The plan appendix ownership partition (authoritative). Every convex file
 * that exposes ingress belongs to exactly one row; anything else is an orphan
 * and a Phase A failure.
 */
export const UNIT_OWNERSHIP: readonly UnitOwnership[] = [
  {
    unit: "U1",
    files: [
      "cashControls/deposits.ts",
      "cashControls/registerSessionActivity.ts",
      "operations/approvalRequests.ts",
      "operations/dailyOpening.ts",
      "operations/dailyOperations.ts",
      "operations/openWorkInventoryReviews.ts",
      "operations/operationalWorkItems.ts",
      "operations/skuActivity.ts",
      "operations/staffMessages.ts",
      "stockOps/cycleCountDrafts.ts",
    ],
  },
  {
    unit: "U2",
    files: [
      "pos/public/catalog.ts",
      "pos/public/customers.ts",
      "pos/public/posRecoveryCodes.ts",
      "pos/public/register.ts",
      "pos/public/sync.ts",
      "pos/public/telemetry.ts",
      "pos/public/terminalAppSessions.ts",
      "pos/public/terminals.ts",
      "pos/public/transactions.ts",
    ],
  },
  {
    unit: "U3",
    files: [
      "inventory/bannerMessage.ts",
      "inventory/bestSeller.ts",
      "inventory/catalogImport.ts",
      "inventory/categories.ts",
      "inventory/colors.ts",
      "inventory/complimentaryProduct.ts",
      "inventory/featuredItem.ts",
      "inventory/inventoryImportCostOverlay.ts",
      "inventory/productSku.ts",
      "inventory/productUtil.ts",
      "inventory/products.ts",
      "inventory/promoCode.ts",
      "inventory/skuSearch.ts",
      "inventory/stockValidation.ts",
      "inventory/storeSchedule.ts",
      "inventory/subcategories.ts",
    ],
  },
  {
    unit: "U4",
    files: [
      "inventory/auth.ts",
      "inventory/expenseSessionItems.ts",
      "inventory/expenseSessions.ts",
      "inventory/expenseTransactions.ts",
      "inventory/inviteCode.ts",
      "inventory/organizationMembers.ts",
      "inventory/organizations.ts",
      "inventory/posSessionItems.ts",
      "inventory/posSessions.ts",
      "inventory/stores.ts",
    ],
  },
  {
    unit: "U5",
    files: [
      "cashControls/closeouts.ts",
      "customerMessaging/public.ts",
      "inventoryLedger/corrections.ts",
      "notifications/subscriptions.ts",
      "operations/dailyClose.ts",
      "operations/dailyManagerReportEmail.ts",
      "operations/dailyOperationsAutomation.ts",
      "operations/managerElevations.ts",
      "operations/operationalEvents.ts",
      "operations/serviceIntake.ts",
      "operations/staffCredentials.ts",
      "operations/staffProfiles.ts",
      "serviceOps/appointments.ts",
      "serviceOps/catalog.ts",
      "serviceOps/serviceCases.ts",
      "stockOps/adjustments.ts",
      "stockOps/purchaseOrders.ts",
      "stockOps/receiving.ts",
      "stockOps/replenishment.ts",
      "stockOps/vendors.ts",
      "workflowTraces/public.ts",
    ],
  },
  {
    unit: "U6",
    files: [
      "schema.ts",
      "storeFront/auth.ts",
      "storeFront/bag.ts",
      "storeFront/bagItem.ts",
      "storeFront/checkoutSession.ts",
      "storeFront/customerBehaviorTimeline.ts",
      "storeFront/guest.ts",
      "storeFront/homepageSnapshot.ts",
      "storeFront/offers.ts",
      "storeFront/payment.ts",
      "storeFront/paystackActions.ts",
      "storeFront/rewards.ts",
      "storeFront/savedBag.ts",
      "storeFront/supportTicket.ts",
      "storeFront/user.ts",
      "storeFront/users.ts",
    ],
  },
  {
    unit: "U7",
    files: [
      "storeFront/analytics.ts",
      "storeFront/helpers/orderUpdateEmails.ts",
      "storeFront/onlineOrder.ts",
      "storeFront/onlineOrderItem.ts",
      "storeFront/onlineOrderUtilFns.ts",
      "storeFront/reviews.ts",
    ],
  },
  {
    unit: "U8",
    files: [
      "inventory/athenaUser.ts",
      "lib/athenaUserAuth.ts",
      "reports/access.ts",
      "reports/customRange.ts",
      "reports/liveDay.ts",
      "reports/queries.ts",
      "reports/skuMixRange.ts",
      "reports/skuMovementRange.ts",
    ],
  },
  {
    unit: "U9",
    files: [
      "app.ts",
      "cloudflare/stream.ts",
      "contextTracking/athenaWebappEvents.ts",
      "contextTracking/sharedDemoEvents.ts",
      "devPatchBadTransaction.ts",
      "harnessWaiver/passkeys.ts",
      "harnessWaiver/registrationAuthorization.ts",
      "intelligence/capabilities/actions.ts",
      "intelligence/runs.ts",
      "llm/storeInsights.ts",
      "llm/userInsights.ts",
      "otp/appLoginEmailAllowlist.ts",
      "remoteAssist/public.ts",
      "remoteAssist/transport.ts",
      "sharedDemo/admission.ts",
      "sharedDemo/public.ts",
    ],
  },
  { unit: "U10", prefixes: ["http/domains/customerChannel/"] },
  {
    unit: "U11",
    files: ["http.ts"],
    prefixes: [
      "http/domains/core/",
      "http/domains/customerMessaging/",
      "http/domains/moneyMovement/",
    ],
  },
  { unit: "framework", files: ["auth.ts"] },
];

const CALLER_TABLE_RELATIVE_PATH =
  "docs/plans/2026-08-16-002-backend-caller-table.md";
const DOWNSTREAM_WRITES_RELATIVE_PATH =
  "docs/plans/2026-08-16-002-downstream-writes.md";

const HTTP_VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);
/**
 * Every Hono method that registers or composes ingress. A call to one of these
 * on a receiver the checker cannot resolve to a router is a finding, never a
 * silent skip.
 */
const ROUTER_METHODS = new Set([...HTTP_VERBS, "on", "route", "mount", "use"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RUN_METHODS = new Set(["runQuery", "runMutation", "runAction"]);
const SCHEDULER_METHODS = new Set(["runAfter", "runAt"]);

/**
 * The Convex CLI's entry-point extension list (`cli.bundle.cjs`
 * `ENTRY_POINT_EXTENSIONS`). Discovery walks EXACTLY the files the bundler
 * registers functions from: a public `mutation` in `view.tsx` or `evil.mjs`
 * is deployed exactly like one in `x.ts`, so it is discovered exactly like one.
 */
const ENTRY_POINT_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".jsx",
] as const;
/** Any entry-point extension — all name the same TypeScript source. */
const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/;
/** The generated builder module and api object, resolved (never suffix-matched). */
const GENERATED_SERVER_CONVEX_PATH = "_generated/server.ts";
const GENERATED_API_CONVEX_PATH = "_generated/api.ts";
/**
 * The generic builders `_generated/server`'s `mutation` / `query` / `action`
 * ARE. Importing them from `convex/server` registers a public function exactly
 * the same way, so they are discovered under the same kinds.
 */
const CONVEX_SERVER_GENERIC_BUILDERS: Readonly<Record<string, IngressKind>> = {
  mutationGeneric: "mutation",
  queryGeneric: "query",
  actionGeneric: "action",
  httpActionGeneric: "http",
};
/**
 * The raw HTTP builder (`httpAction` from `_generated/server`,
 * `httpActionGeneric` from `convex/server`). `HttpRouter.route({ path, method,
 * handler: httpAction(...) })` registers a live route the Hono walk never sees,
 * and this repo admits HTTP ingress ONLY as Hono routes under `admitHttpRoute`
 * / `admitHttpRead` — so there is no accepted shape for it: ANY value
 * reference to it is `ingress-not-statically-resolvable` (round 6).
 */
const isRawHttpBuilderKind = (kind: IngressKind | undefined) => kind === "http";
const RAW_HTTP_BUILDER_REASON =
  "a raw httpAction registered on the Convex HttpRouter (`http.route({ path, method, handler })`) is a live HTTP ingress the Hono route walk never sees, and this repo has no admitted shape for it — every HTTP route must be a Hono route under `admitHttpRoute` / `admitHttpRead`";
/** The origin allowlist module; the only source a CORS `origin` may draw on. */
const STOREFRONT_ORIGINS_CONVEX_PATH = "platform/storefrontOrigins.ts";

/**
 * Repo root from this module's own location, so the checker is cwd-independent
 * (it runs from the repo root and from `packages/athena-webapp` alike).
 *
 * Bundlers rewrite `import.meta.url` to a non-file scheme, so fall back to
 * walking up from the cwd for the marker file when that happens.
 */
function resolveDefaultRepoRoot() {
  try {
    return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  } catch {
    let current = path.resolve(process.cwd());
    for (let depth = 0; depth < 8; depth += 1) {
      if (
        existsSync(
          path.join(current, "scripts/convex-operation-admission-check.ts"),
        )
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return process.cwd();
  }
}

const DEFAULT_REPO_ROOT = resolveDefaultRepoRoot();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function normalizeRepoPath(filePath: string) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function slugifyForFindingId(value: string) {
  return normalizeRepoPath(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The Convex bundler's own entry-point rules, mirrored so discovery covers
 * exactly the modules that get deployed: any entry-point extension; only the
 * TOP-LEVEL `_generated/` is skipped (a nested `foo/_generated/evil.ts` IS
 * bundled); a basename that is a dotfile, an emacs tempfile, or has more than
 * one dot (`x.test.ts`, `x.d.ts`, `convex.config.ts`) is skipped, as is a path
 * containing a space. `schema.ts` is skipped by the bundler too, but scanning
 * it is harmless and it stays in the ownership partition.
 */
function isExcludedConvexSourcePath(filePath: string) {
  const relative = toConvexRelativePath(filePath);
  const base = path.posix.basename(relative);
  return (
    !ENTRY_POINT_EXTENSIONS.some((extension) => relative.endsWith(extension)) ||
    relative.startsWith("_generated/") ||
    base.startsWith(".") ||
    base.startsWith("#") ||
    (base.match(/\./g) ?? []).length > 1 ||
    relative.includes(" ")
  );
}

function toConvexRelativePath(filePath: string) {
  return normalizeRepoPath(filePath).replace(
    /^.*packages\/athena-webapp\/convex\//,
    "",
  );
}

function stripSourceExtension(filePath: string) {
  return filePath.replace(SOURCE_EXTENSION_PATTERN, "");
}

function toConvexModuleName(filePath: string) {
  return stripSourceExtension(toConvexRelativePath(filePath));
}

function scriptKindFor(filePath: string) {
  if (/\.(?:tsx|jsx)$/.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseSource(filePath: string, source: string) {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    .line + 1;
}

function hasExportModifier(node: ts.Node) {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function stringLiteralText(node: ts.Node | undefined) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function joinRoutePath(prefix: string, suffix: string) {
  const left = prefix.replace(/\/+$/, "");
  const right = suffix.startsWith("/") ? suffix : `/${suffix}`;
  const joined = `${left}${right}`.replace(/\/{2,}/g, "/");
  return joined === "" ? "/" : joined.replace(/(.+)\/$/, "$1");
}

// ---------------------------------------------------------------------------
// Module model
// ---------------------------------------------------------------------------

export type ConvexModule = {
  /** Repo-relative path. */
  filePath: string;
  /** Convex-relative path, e.g. `inventory/products.ts`. */
  convexPath: string;
  moduleName: string;
  source: string;
  sourceFile: ts.SourceFile;
};

type ImportBinding = {
  /** Local name in this module. */
  local: string;
  /** Imported name, or `*` for a namespace import. */
  imported: string;
  moduleSpecifier: string;
};

function collectImportBindings(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    // `import type` erases; it binds no value this checker can follow.
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) {
      bindings.push({
        local: clause.name.text,
        imported: "default",
        moduleSpecifier,
      });
    }
    const named = clause.namedBindings;
    if (!named) continue;
    if (ts.isNamespaceImport(named)) {
      bindings.push({
        local: named.name.text,
        imported: "*",
        moduleSpecifier,
      });
      continue;
    }
    for (const element of named.elements) {
      if (element.isTypeOnly) continue;
      bindings.push({
        local: element.name.text,
        imported: element.propertyName?.text ?? element.name.text,
        moduleSpecifier,
      });
    }
  }
  return bindings;
}

/**
 * Resolve a relative module specifier against the importing module, returning
 * a convex-relative path.
 *
 * The specifier is NORMALIZED (`../_generated/./server`,
 * `../_generated/server/../server`, and `../_generated/server` all name one
 * file, and the checker compares resolved paths, never spellings), its source
 * extension is stripped (a `.js` / `.mjs` / `.mts` specifier names the same
 * TypeScript source under ESM resolution), and every entry-point extension is
 * tried against the known module set, for the file and for a directory
 * `index`. Without a known set, or when nothing matches, the `.ts` spelling is
 * returned so callers can still compare it against a contract path.
 */
/**
 * The `paths` aliases `packages/athena-webapp/tsconfig.json` declares:
 * `~/*` -> `./*` (the webapp root), `@/*` -> `./src/*`, `@cvx/*` ->
 * `./convex/*`. `convex/tsconfig.json` declares none, and the Convex bundler
 * does not resolve them inside convex/** — so an alias import in a convex
 * module is a spelling the RUNTIME cannot follow. The checker resolves it
 * anyway (so `@cvx/_generated/api` still names the api root and
 * `~/convex/_generated/server` the builders) AND discovery / the CORS
 * assertion fail closed on the import itself (round 7).
 */
const TSCONFIG_PATH_ALIASES: readonly { prefix: string; target: string }[] = [
  { prefix: "@cvx/", target: "" },
  { prefix: "~/", target: "../" },
  { prefix: "@/", target: "../src/" },
];

function isTsconfigAliasSpecifier(specifier: string) {
  return TSCONFIG_PATH_ALIASES.some((alias) => specifier.startsWith(alias.prefix));
}

/** An alias specifier rewritten to a convex-root-relative path, else `undefined`. */
function resolveTsconfigAlias(specifier: string) {
  for (const alias of TSCONFIG_PATH_ALIASES) {
    if (specifier.startsWith(alias.prefix)) {
      return path.posix.normalize(
        `${alias.target}${specifier.slice(alias.prefix.length)}`,
      );
    }
  }
  return undefined;
}

function resolveModuleSpecifier(
  fromConvexPath: string,
  specifier: string,
  knownConvexPaths?: ReadonlySet<string>,
) {
  const aliased = resolveTsconfigAlias(specifier);
  if (aliased !== undefined) {
    // `~/convex/x` is `x`; `~/src/x` and `@/x` leave the tree.
    const rebased = aliased.startsWith("../convex/")
      ? aliased.slice("../convex/".length)
      : aliased;
    return resolveModuleSpecifier(
      "index.ts",
      rebased.startsWith(".") ? rebased : `./${rebased}`,
      knownConvexPaths,
    );
  }
  if (!specifier.startsWith(".")) return undefined;
  const resolved = stripSourceExtension(
    path.posix.normalize(
      path.posix.join(path.posix.dirname(fromConvexPath), specifier),
    ),
  );
  const file = `${resolved}.ts`;
  if (!knownConvexPaths) return file;
  for (const extension of ENTRY_POINT_EXTENSIONS) {
    const candidate = `${resolved}${extension}`;
    if (knownConvexPaths.has(candidate)) return candidate;
  }
  // Directory import: `./routes` resolves to `./routes/index.<ext>`.
  for (const extension of ENTRY_POINT_EXTENSIONS) {
    const candidate = `${resolved}/index${extension}`;
    if (knownConvexPaths.has(candidate)) return candidate;
  }
  return file;
}

/** Does this resolved convex-relative path leave the convex tree? */
function escapesConvexTree(convexPath: string) {
  return convexPath === ".." || convexPath.startsWith("../");
}

/**
 * Locate a source file on disk for a specifier that resolves OUTSIDE the
 * scanned convex tree (`../../shared/impl`), trying every entry-point
 * extension and a directory index. Returns the absolute path or `undefined`.
 */
function locateExternalSourceFile(
  repoRoot: string,
  fromRepoRelativePath: string,
  specifier: string,
) {
  const base = stripSourceExtension(
    path.resolve(repoRoot, path.dirname(fromRepoRelativePath), specifier),
  );
  for (const extension of ENTRY_POINT_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const extension of ENTRY_POINT_EXTENSIONS) {
    const candidate = path.join(base, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Wrapper grammar (whitelist)
// ---------------------------------------------------------------------------

/**
 * Admission is recognized by a CLOSED GRAMMAR, not by rejecting known-bad shapes.
 *
 * Three consecutive review rounds defeated the previous blacklist, each time
 * with a spelling it did not enumerate: a const-bound wrapper declaration
 * mistaken for an invocation; pre-admission work hidden in the invocation's
 * arguments; an IIFE in that argument list; a computed `ctx["db"]` receiver; a
 * destructured `db`; a handler parameter default. Every round the argument was
 * "the new predicate accepts everything the old one accepted", which reasons
 * about the predicate rather than about the set of programs with the same
 * runtime effect — so every round left a shape nobody had thought of.
 *
 * The rule is therefore inverted. An ingress is admitted if and only if its
 * handler is one of the three shapes below and its wrapper resolves to the
 * composition root. Anything else — any other expression form anywhere in the
 * wrapper's argument list, any wrapping arrow other than the denial-mapping
 * try, any parameter default — is rejected with a `wrapper-shape` finding that
 * names the accepted shapes, so the remediation needs no reading of this file.
 */
export const ACCEPTED_WRAPPER_SHAPES = [
  "handler: admitX(<definition identifier or dotted member>, <handler identifier | inline arrow | function expression>)",
  "handler: <const> where the module declares `const <const> = admitX(<definition>, <handler>)` at top level",
  "handler: async (ctx, args) => { try { return await <one of the two shapes above>(ctx, args); } catch (error) { ...map the denial WITHOUT touching ctx or args... } }",
].join("\n    ");

/**
 * The single module whose exports are canonical wrappers, as a convex-relative
 * path. Import specifiers are RESOLVED against the importing file before being
 * compared: matching an unresolved path SUFFIX let any module named
 * `<anything>/platform/operationAdmission.ts` — or a package specifier like
 * `@evil/platform/operationAdmission` — stand in for the rail while the checker
 * reported zero findings, which is exactly the exemption construct this
 * contract exists to remove.
 */
const COMPOSITION_ROOT_CONVEX_PATH = "platform/operationAdmission.ts";

export type WrapperMatch = {
  wrapper: string;
  kind: IngressKind;
  /** The wrapper identifier resolves to the composition root module. */
  fromRoot: boolean;
  /** The definition argument, when the match is a full application. */
  definition?: DefinitionReference;
};

/** `a.b.c` -> `{ root: "a", path: ["b", "c"] }`; only for dotted chains. */
function toDefinitionReference(node: ts.Expression): DefinitionReference {
  const path: string[] = [];
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) {
    path.unshift(current.name.text);
    current = current.expression;
  }
  return { root: (current as ts.Identifier).text, path };
}

/** A grammar decision: a match, a shape violation, or "no wrapper here". */
type ShapeOutcome = { match?: WrapperMatch; reason?: string };

type WrapperNames = {
  /** local name -> ingress kind, imported from the composition root. */
  canonical: Map<string, IngressKind>;
  /** local name -> ingress kind, but imported from somewhere else. */
  offComposition: Map<string, IngressKind>;
  /**
   * Local names of `import * as x` bindings that RESOLVE to the composition
   * root. Only these receivers may carry a wrapper method.
   */
  rootNamespaces: Set<string>;
  /** Top-level `const X = admitX(def, handler)` of the accepted shape. */
  bound: Map<string, WrapperMatch>;
  /** Top-level `const X = admitX(...)` that is NOT of the accepted shape. */
  boundInvalid: Map<string, string>;
};

function describeExpressionForOperator(node: ts.Node): string {
  switch (node.kind) {
    case ts.SyntaxKind.CallExpression:
      return "a call expression";
    case ts.SyntaxKind.AwaitExpression:
      return "an await expression";
    case ts.SyntaxKind.SpreadElement:
      return "a spread element";
    case ts.SyntaxKind.ConditionalExpression:
      return "a conditional expression";
    case ts.SyntaxKind.BinaryExpression:
      return "a binary expression (comma, logical, or assignment operator)";
    case ts.SyntaxKind.ParenthesizedExpression:
      return "a parenthesized expression";
    case ts.SyntaxKind.ElementAccessExpression:
      return "a computed element access";
    case ts.SyntaxKind.ObjectLiteralExpression:
      return "an object literal";
    case ts.SyntaxKind.ArrayLiteralExpression:
      return "an array literal";
    case ts.SyntaxKind.ArrowFunction:
      return "an arrow function";
    case ts.SyntaxKind.FunctionExpression:
      return "a function expression";
    case ts.SyntaxKind.AsExpression:
    case ts.SyntaxKind.SatisfiesExpression:
      return "a type assertion";
    case ts.SyntaxKind.NonNullExpression:
      return "a non-null assertion";
    case ts.SyntaxKind.TaggedTemplateExpression:
      return "a tagged template";
    default:
      return `a ${ts.SyntaxKind[node.kind]}`;
  }
}

/**
 * `a`, `a.b`, `a.b.c` — identifiers only, no calls, no computed access, no
 * optional chaining. Evaluating one of these cannot run user code, which is the
 * whole reason the definition argument is allowed to be a member expression.
 */
function isDottedIdentifierChain(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return true;
  return (
    ts.isPropertyAccessExpression(node) &&
    node.questionDotToken === undefined &&
    ts.isIdentifier(node.name) &&
    isDottedIdentifierChain(node.expression)
  );
}

/**
 * The wrapper this callee expression denotes, or `undefined`.
 *
 * A bare identifier qualifies when it was imported under a canonical wrapper
 * name (from the composition root or not — an off-root import is recognized so
 * it can raise its own finding rather than vanishing). A property access
 * qualifies only when its receiver is a namespace import that RESOLVES to the
 * composition root; no other receiver, computed or otherwise, is a wrapper.
 */
function wrapperReference(
  node: ts.Expression,
  names: WrapperNames,
): WrapperMatch | undefined {
  if (ts.isIdentifier(node)) {
    const canonicalKind = names.canonical.get(node.text);
    if (canonicalKind) {
      return { wrapper: node.text, kind: canonicalKind, fromRoot: true };
    }
    const offKind = names.offComposition.get(node.text);
    return offKind
      ? { wrapper: node.text, kind: offKind, fromRoot: false }
      : undefined;
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    node.questionDotToken === undefined &&
    ts.isIdentifier(node.expression) &&
    names.rootNamespaces.has(node.expression.text)
  ) {
    const kind = CANONICAL_WRAPPERS[node.name.text];
    return kind ? { wrapper: node.name.text, kind, fromRoot: true } : undefined;
  }
  return undefined;
}

/** Does a canonical wrapper appear anywhere inside this expression? */
function containsWrapperReference(node: ts.Node, names: WrapperNames): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) return;
    if (
      (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current)) &&
      wrapperReference(current, names)
    ) {
      found = true;
      return;
    }
    if (ts.isIdentifier(current) && names.boundInvalid.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/**
 * Shape 1: `admitX(<definition>, <handler>)`.
 *
 * Exactly two arguments. The definition may only be an identifier or a dotted
 * member expression, and the handler only an identifier, an inline arrow, or a
 * function expression. Nothing else is allowed to appear in the argument list,
 * because a call's arguments are evaluated after its callee and before the
 * wrapper closure is applied: a nested call, an `await`, an IIFE, a spread, a
 * conditional, or a comma operator all run for a caller nobody has admitted.
 *
 * Returns `undefined` when this is not a wrapper application at all, so the
 * caller can distinguish "wrong shape" from "no wrapper here".
 */
function matchWrapperApplication(
  node: ts.Expression,
  names: WrapperNames,
): ShapeOutcome | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const reference = wrapperReference(node.expression, names);
  if (!reference) return undefined;

  if (node.questionDotToken) {
    return {
      reason:
        "the wrapper is invoked through optional chaining, so admission can be skipped entirely when the wrapper is nullish",
    };
  }
  if (node.arguments.length !== 2) {
    return {
      reason: `the wrapper is called with ${node.arguments.length} argument(s); it takes exactly two, the operation definition and the handler`,
    };
  }

  const [definition, handler] = node.arguments;
  if (!isDottedIdentifierChain(definition)) {
    return {
      reason: `the wrapper's first argument is ${describeExpressionForOperator(definition)}; only a definition identifier or a dotted member expression is accepted, because anything else executes before admission`,
    };
  }
  if (
    !ts.isIdentifier(handler) &&
    !ts.isArrowFunction(handler) &&
    !ts.isFunctionExpression(handler)
  ) {
    return {
      reason: `the wrapper's second argument is ${describeExpressionForOperator(handler)}; only a handler identifier, an inline arrow, or a function expression is accepted, because anything else executes before admission`,
    };
  }

  return {
    match: { ...reference, definition: toDefinitionReference(definition) },
  };
}

/**
 * The catch and finally clauses of the denial-mapping handler run for a caller
 * the wrapper has just DENIED — the denial is thrown by the wrapper, so the
 * catch is exactly the code that runs when admission fails, with the outer
 * `ctx` / `args` in scope. They are therefore pinned too: neither clause may
 * mention an outer parameter (`catch (error) { return fn(ctx, args); }` is the
 * unadmitted handler wearing a try), and every call in them must have a plain
 * identifier or dotted-member callee, so an IIFE or computed callee cannot
 * smuggle a closure over the parameters in.
 */
function denialClauseViolation(
  clause: ts.Block,
  label: "catch" | "finally",
  parameterNames: ReadonlySet<string>,
): string | undefined {
  let reason: string | undefined;
  const visit = (node: ts.Node) => {
    if (reason) return;
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      if (parameterNames.has(node.text) && isValueReference(node)) {
        reason = `the ${label} clause references the outer handler's \`${node.text}\` parameter; the ${label} clause runs when the wrapper has DENIED the caller, so it may not touch ctx or args`;
        return;
      }
      if (node.text === "arguments" && isValueReference(node)) {
        reason = `the ${label} clause reads \`arguments\`, which reaches the outer handler's ctx and args after a denial`;
        return;
      }
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      reason = `the ${label} clause reads \`this\`; only a plain denial mapping over the caught error is accepted there`;
      return;
    }
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      !isDottedIdentifierChain(node.expression)
    ) {
      reason = `the ${label} clause calls ${describeExpressionForOperator(node.expression)}; only a plain identifier or dotted-member callee is accepted there, because anything else can close over the denied caller's ctx and args`;
      return;
    }
    if (ts.isCallExpression(node) && node.questionDotToken) {
      reason = `the ${label} clause invokes a callee through optional chaining; only a plain identifier or dotted-member callee is accepted there`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(clause);
  return reason;
}

/**
 * Shape 3: the denial-mapping handler.
 *
 * ```
 * async (ctx, args) => {
 *   try {
 *     return await admitX(definition, handler)(ctx, args);
 *   } catch (error) { ...map the typed denial to a CommandResult... }
 * }
 * ```
 *
 * This is the only wrapping function the grammar accepts, and it exists for one
 * reason: a denial is thrown BY the wrapper, so the only place to translate it
 * into a `CommandResult` is around the wrapper call (see the closing comment in
 * `convex/platform/operationAdmission.ts`, which retired `resolveWriteAdmission`
 * in favour of exactly this shape).
 *
 * Everything about it is pinned. The parameters must be plain identifiers with
 * no defaults and no destructuring — a default evaluates on every call before
 * the wrapper closure is applied, and destructuring `{ db }` off `ctx` produces
 * a receiver that is neither `ctx.db` nor anything a receiver-shaped predicate
 * would recognize. The try block holds exactly one statement, a return of the
 * invocation, and the invocation's arguments must be those same parameters
 * forwarded verbatim, so no expression at all is evaluated between entering the
 * handler and applying the wrapper. The catch and finally clauses run AFTER the
 * wrapper has been applied — but "applied" includes DENIED, and the denial is
 * what lands in the catch. So they are pinned as well (`denialClauseViolation`):
 * no reference to the outer parameters, no `this` / `arguments`, and only
 * plain identifier or dotted-member callees.
 */
function matchDenialMappingHandler(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  names: WrapperNames,
): ShapeOutcome | undefined {
  const shapeSuffix =
    "the only wrapping handler the grammar accepts is `async (ctx, args) => { try { return await <wrapper>(ctx, args); } catch (error) { ... } }`";

  for (const parameter of fn.parameters) {
    if (parameter.initializer) {
      return {
        reason: `the outer handler's \`${parameter.name.getText()}\` parameter has a default value, and defaults are evaluated on every invocation before the wrapper closure is applied`,
      };
    }
    if (parameter.dotDotDotToken) {
      return {
        reason: `the outer handler takes a rest parameter, so its arguments cannot be forwarded verbatim; ${shapeSuffix}`,
      };
    }
    if (!ts.isIdentifier(parameter.name)) {
      return {
        reason: `the outer handler destructures a parameter; a destructured \`ctx\` yields bare \`db\` / \`scheduler\` locals that can run before admission, so plain identifier parameters forwarded verbatim are required`,
      };
    }
  }

  const body = fn.body;
  if (!ts.isBlock(body)) {
    return {
      reason: `the handler is an arrow whose body wraps the wrapper in another expression; ${shapeSuffix}`,
    };
  }
  if (body.statements.length !== 1) {
    return {
      reason: `the outer handler's body has ${body.statements.length} statements; ${shapeSuffix}`,
    };
  }

  const [only] = body.statements;
  if (!ts.isTryStatement(only)) {
    return {
      reason: `the outer handler's body is a ${ts.SyntaxKind[only.kind]} rather than a denial-mapping try; ${shapeSuffix}`,
    };
  }
  if (only.tryBlock.statements.length !== 1) {
    return {
      reason: `the try block holds ${only.tryBlock.statements.length} statements; it must hold exactly the admitted invocation, so nothing runs before admission`,
    };
  }

  const [inner] = only.tryBlock.statements;
  if (!ts.isReturnStatement(inner) || !inner.expression) {
    return {
      reason: `the try block's only statement is a ${ts.SyntaxKind[inner.kind]} rather than \`return await <wrapper>(ctx, args);\``,
    };
  }

  let invocation: ts.Expression = inner.expression;
  if (ts.isAwaitExpression(invocation)) invocation = invocation.expression;
  if (!ts.isCallExpression(invocation) || invocation.questionDotToken) {
    return {
      reason: `the try block returns ${describeExpressionForOperator(invocation)} rather than a direct invocation of the wrapper`,
    };
  }

  if (invocation.arguments.length !== fn.parameters.length) {
    return {
      reason: `the admitted invocation is applied to ${invocation.arguments.length} argument(s) but the outer handler declares ${fn.parameters.length}; the parameters must be forwarded verbatim so no expression is evaluated before admission`,
    };
  }
  for (let index = 0; index < invocation.arguments.length; index += 1) {
    const argument = invocation.arguments[index];
    const parameterName = (fn.parameters[index].name as ts.Identifier).text;
    if (!ts.isIdentifier(argument) || argument.text !== parameterName) {
      return {
        reason: `argument ${index + 1} of the admitted invocation is ${describeExpressionForOperator(argument)} rather than the outer handler's \`${parameterName}\` parameter forwarded verbatim; anything else is evaluated before the wrapper is applied`,
      };
    }
  }

  const parameterNames = new Set(
    fn.parameters.map((parameter) => (parameter.name as ts.Identifier).text),
  );
  const catchViolation = only.catchClause
    ? denialClauseViolation(only.catchClause.block, "catch", parameterNames)
    : undefined;
  if (catchViolation) return { reason: catchViolation };
  const finallyViolation = only.finallyBlock
    ? denialClauseViolation(only.finallyBlock, "finally", parameterNames)
    : undefined;
  if (finallyViolation) return { reason: finallyViolation };

  const callee = invocation.expression;
  const applied = matchWrapperApplication(callee, names);
  if (applied) return applied;
  if (ts.isIdentifier(callee)) {
    const bound = names.bound.get(callee.text);
    if (bound) return { match: bound };
    const invalid = names.boundInvalid.get(callee.text);
    if (invalid) return { reason: invalid };
  }
  return undefined;
}

/**
 * Decide whether a `handler` property (or a Hono route handler argument) is
 * admitted, and if not, why its shape was rejected.
 *
 * `{}` means no canonical wrapper appears anywhere in the expression — a
 * different remediation ("add the wrapper") from a shape violation ("spell it
 * the accepted way"), so the two raise different findings.
 */
function matchHandlerGrammar(
  expression: ts.Expression | undefined,
  names: WrapperNames,
): ShapeOutcome {
  if (!expression) return {};

  // Shape 1.
  const applied = matchWrapperApplication(expression, names);
  if (applied) return applied;

  // Shape 2.
  if (ts.isIdentifier(expression)) {
    const bound = names.bound.get(expression.text);
    if (bound) return { match: bound };
    const invalid = names.boundInvalid.get(expression.text);
    return invalid ? { reason: invalid } : {};
  }

  // Shape 3. Its structural checks fire on any function, including handlers
  // that never mention the rail at all, so a rejection is only reported as a
  // SHAPE violation when a canonical wrapper is actually present somewhere in
  // the handler. Otherwise this is a plain unadmitted ingress, whose
  // remediation is "add the wrapper" rather than "spell it differently".
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    const mapped = matchDenialMappingHandler(expression, names);
    if (mapped?.match) return mapped;
    if (mapped?.reason && containsWrapperReference(expression, names)) {
      return mapped;
    }
    if (mapped) return {};
  }

  return containsWrapperReference(expression, names)
    ? {
        reason:
          "a canonical admission wrapper appears inside the handler, but the handler is not one of the accepted shapes",
      }
    : {};
}

/**
 * Resolve the wrapper names a module has in scope.
 *
 * `convexPath` is the importing module's convex-relative path; every import
 * specifier is resolved against it, and only a specifier that resolves to
 * `platform/operationAdmission.ts` counts as the composition root. A bare or
 * package specifier never resolves, so it never qualifies.
 */
function collectWrapperNames(
  sourceFile: ts.SourceFile,
  convexPath: string,
): WrapperNames {
  const canonical = new Map<string, IngressKind>();
  const offComposition = new Map<string, IngressKind>();
  const rootNamespaces = new Set<string>();
  const bound = new Map<string, WrapperMatch>();
  const boundInvalid = new Map<string, string>();

  for (const binding of collectImportBindings(sourceFile)) {
    const resolved = resolveModuleSpecifier(convexPath, binding.moduleSpecifier);
    const fromRoot = resolved === COMPOSITION_ROOT_CONVEX_PATH;
    if (binding.imported === "*") {
      if (fromRoot) rootNamespaces.add(binding.local);
      continue;
    }
    const kind = CANONICAL_WRAPPERS[binding.imported];
    if (!kind) continue;
    (fromRoot ? canonical : offComposition).set(binding.local, kind);
  }

  const names: WrapperNames = {
    canonical,
    offComposition,
    rootNamespaces,
    bound,
    boundInvalid,
  };

  // Shape 2's binding site: a top-level `const X = admitX(def, handler)`.
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }
      const outcome = matchWrapperApplication(declaration.initializer, names);
      if (!outcome) continue;
      if (outcome.match) bound.set(declaration.name.text, outcome.match);
      else if (outcome.reason) {
        boundInvalid.set(declaration.name.text, outcome.reason);
      }
    }
  }

  return names;
}

// ---------------------------------------------------------------------------
// Convex function ingress discovery
// ---------------------------------------------------------------------------

type RegistrationNames = {
  /** local name -> ingress kind, for named builder imports. */
  byLocalName: Map<string, IngressKind>;
  /** `import * as server from "../_generated/server"` locals. */
  serverNamespaces: Set<string>;
  /** `import * as convexServer from "convex/server"` locals. */
  convexServerNamespaces: Set<string>;
};

/**
 * Does this specifier, imported from the module at `convexPath`, RESOLVE to
 * `_generated/server`? Resolution, not a suffix regex: `../_generated/./server`
 * and `../_generated/server/../server` name the same file, and a shim module
 * named `server.ts` under some other `_generated/` directory does not.
 */
function isGeneratedServerSpecifier(convexPath: string, specifier: string) {
  return (
    resolveModuleSpecifier(convexPath, specifier) === GENERATED_SERVER_CONVEX_PATH
  );
}

/**
 * Every local name that denotes a public registration builder: `mutation` /
 * `query` / `action` from `_generated/server` (resolved, aliased or
 * namespaced) and the generic builders from `convex/server` that those ARE.
 */
function getConvexRegistrationNames(
  sourceFile: ts.SourceFile,
  isGeneratedServer: (specifier: string) => boolean,
): RegistrationNames {
  const byLocalName = new Map<string, IngressKind>();
  const serverNamespaces = new Set<string>();
  const convexServerNamespaces = new Set<string>();

  for (const binding of collectImportBindings(sourceFile)) {
    if (isGeneratedServer(binding.moduleSpecifier)) {
      if (binding.imported === "*") {
        serverNamespaces.add(binding.local);
        continue;
      }
      if (
        binding.imported === "mutation" ||
        binding.imported === "query" ||
        binding.imported === "action"
      ) {
        byLocalName.set(binding.local, binding.imported);
      }
      if (binding.imported === "httpAction") byLocalName.set(binding.local, "http");
      continue;
    }
    if (binding.moduleSpecifier === "convex/server") {
      if (binding.imported === "*") {
        convexServerNamespaces.add(binding.local);
        continue;
      }
      const kind = CONVEX_SERVER_GENERIC_BUILDERS[binding.imported];
      if (kind) byLocalName.set(binding.local, kind);
    }
  }

  return { byLocalName, serverNamespaces, convexServerNamespaces };
}

/**
 * Peel type-only and grouping wrappers — `as`, `satisfies`, `<T>x`, `x!`,
 * `(x)` — which change nothing about what Convex registers.
 */
function unwrapTypeOnly(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/** Every name a binding name node (identifier or pattern) declares. */
function bindingNameTexts(name: ts.BindingName, into: Set<string>) {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNameTexts(element.name, into);
  }
}

/** Names declared directly in one lexical scope (not the source file). */
function namesDeclaredInScope(scope: ts.Node): Set<string> {
  const names = new Set<string>();
  const addStatements = (statements: ts.NodeArray<ts.Statement>) => {
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          bindingNameTexts(declaration.name, names);
        }
      } else if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name
      ) {
        names.add(statement.name.text);
      }
    }
  };
  if (ts.isBlock(scope) || ts.isModuleBlock(scope)) addStatements(scope.statements);
  else if (ts.isCaseBlock(scope)) {
    for (const clause of scope.clauses) addStatements(clause.statements);
  } else if (ts.isFunctionLike(scope)) {
    for (const parameter of scope.parameters) bindingNameTexts(parameter.name, names);
    if (
      (ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) &&
      scope.name
    ) {
      names.add(scope.name.text);
    }
  } else if (ts.isCatchClause(scope) && scope.variableDeclaration) {
    bindingNameTexts(scope.variableDeclaration.name, names);
  } else if (
    (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    for (const declaration of scope.initializer.declarations) {
      bindingNameTexts(declaration.name, names);
    }
  }
  return names;
}

/**
 * Is this identifier reference shadowed by a NESTED declaration of the same
 * name (`const query = ctx.db.query("t"); query.collect()` inside a handler)?
 * Only nested scopes are consulted: a top-level redeclaration of an import is
 * a TypeScript error, so the import always wins at module scope.
 */
function isShadowedReference(node: ts.Identifier): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (namesDeclaredInScope(current).has(node.text)) return true;
    current = current.parent;
  }
  return false;
}

/** The kind a builder REFERENCE denotes (`mutation`, `server.query`, ...). */
function builderReferenceKind(
  expression: ts.Expression,
  names: RegistrationNames,
): IngressKind | undefined {
  const node = unwrapTypeOnly(expression);
  if (ts.isIdentifier(node)) {
    const kind = names.byLocalName.get(node.text);
    return kind && !isShadowedReference(node) ? kind : undefined;
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    !isShadowedReference(node.expression)
  ) {
    const name = node.name.text;
    if (names.serverNamespaces.has(node.expression.text)) {
      if (name === "mutation" || name === "query" || name === "action") {
        return name;
      }
      if (name === "httpAction") return "http";
    }
    if (names.convexServerNamespaces.has(node.expression.text)) {
      return CONVEX_SERVER_GENERIC_BUILDERS[name];
    }
  }
  return undefined;
}

/**
 * Is this identifier a value reference to one of the builder-bearing
 * namespace imports (`import * as server from "../_generated/server"`,
 * `import * as convexServer from "convex/server"`) that is NOT a plain
 * property read off it? `const { mutation } = server`, `const s = server`,
 * `server["mutation"]`, `pick(server)` all hand the builders to a spelling
 * discovery cannot follow.
 */
function isNamespaceEscape(node: ts.Identifier, names: RegistrationNames) {
  if (
    !names.serverNamespaces.has(node.text) &&
    !names.convexServerNamespaces.has(node.text)
  ) {
    return false;
  }
  if (!isValueReference(node) || isShadowedReference(node)) return false;
  const parent = node.parent;
  return !(ts.isPropertyAccessExpression(parent) && parent.expression === node);
}

/**
 * `<builder>({...})` after peeling type-only wrappers off both the call and
 * its callee — the one shape discovery resolves to a registration.
 */
function matchRegistrationCall(
  expression: ts.Expression | undefined,
  names: RegistrationNames,
): { kind: IngressKind; call: ts.CallExpression } | undefined {
  if (!expression) return undefined;
  const node = unwrapTypeOnly(expression);
  if (!ts.isCallExpression(node)) return undefined;
  const kind = builderReferenceKind(node.expression, names);
  // A raw httpAction has no admitted shape; it is judged by `classify` /
  // the orphan sweep as unresolvable, never as a registration.
  return kind && !isRawHttpBuilderKind(kind) ? { kind, call: node } : undefined;
}

/**
 * Does a registration builder appear anywhere in this expression (outside type
 * positions)? Returns the first kind seen, so an unresolvable export can still
 * be reported under a plausible kind.
 */
function findBuilderReference(
  node: ts.Node,
  names: RegistrationNames,
): IngressKind | undefined {
  let found: IngressKind | undefined;
  const visit = (current: ts.Node) => {
    if (found) return;
    if (ts.isTypeNode(current)) return;
    if (ts.isIdentifier(current)) {
      if (!isValueReference(current)) return;
      // `server["mutation"]`, `pick(server)`: the namespace itself escaping a
      // plain property read carries every builder with it.
      if (isNamespaceEscape(current, names)) {
        found = "mutation";
        return;
      }
      found = builderReferenceKind(current, names);
      return;
    }
    if (ts.isPropertyAccessExpression(current)) {
      const kind = builderReferenceKind(current, names);
      if (kind) {
        found = kind;
        return;
      }
      // `.name` is a property, never a binding reference.
      visit(current.expression);
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/**
 * Is this identifier a READ of a binding, as opposed to a property name, a
 * declaration name, a label, or an import/export specifier? `ctx.db.query(...)`
 * mentions `query` without referencing the builder.
 */
function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent)
  ) {
    return parent.name !== node;
  }
  if (ts.isBindingElement(parent)) return parent.propertyName !== node && parent.name !== node;
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent)
  ) {
    return parent.name !== node;
  }
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent) ||
    ts.isQualifiedName(parent) ||
    ts.isJsxAttribute(parent)
  ) {
    return false;
  }
  return true;
}

function handlerExpression(callExpression: ts.CallExpression) {
  const [config] = callExpression.arguments;
  if (!config || !ts.isObjectLiteralExpression(config)) return undefined;
  for (const property of config.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "handler"
    ) {
      return property.initializer;
    }
  }
  return undefined;
}

/**
 * How discovery reaches beyond the one source text it is handed. Without
 * these, a re-export whose target lives outside the convex tree cannot be
 * read and therefore fails closed.
 */
export type IngressDiscoveryOptions = {
  /** Convex-relative paths of every discovered module. */
  knownConvexPaths?: ReadonlySet<string>;
  /** Repository root, so relative specifiers outside convex/ can be located. */
  repoRoot?: string;
  /** Source reader for files outside the scanned tree (defaults to the fs). */
  readSource?: (absolutePath: string) => string | undefined;
};

function defaultReadSource(absolutePath: string) {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Is a module OUTSIDE the convex tree free of registration builders, through
 * its own re-exports? A convex module may re-export from it only when it is:
 * an external module that imports `_generated/server` (resolved on disk) or
 * the generic builders from `convex/server` may hand a public function to the
 * re-exporting module, and discovery cannot see which export that is.
 */
function externalModuleIsBuilderFree(
  absolutePath: string,
  repoRoot: string,
  readSource: (absolutePath: string) => string | undefined,
  visited = new Set<string>(),
  depth = 0,
): boolean {
  if (visited.has(absolutePath)) return true;
  visited.add(absolutePath);
  if (depth > 4) return false;
  const source = readSource(absolutePath);
  if (source === undefined) return false;
  const sourceFile = parseSource(absolutePath, source);
  const generatedServer = path.join(
    repoRoot,
    CONVEX_ROOT_RELATIVE,
    stripSourceExtension(GENERATED_SERVER_CONVEX_PATH),
  );
  const names = getConvexRegistrationNames(sourceFile, (specifier) =>
    specifier.startsWith(".")
      ? stripSourceExtension(
          path.resolve(path.dirname(absolutePath), specifier),
        ) === generatedServer
      : false,
  );
  if (
    names.byLocalName.size > 0 ||
    names.serverNamespaces.size > 0 ||
    names.convexServerNamespaces.size > 0
  ) {
    return false;
  }
  // Every module this one reaches a value through: `export ... from` AND plain
  // imports (round 6 — `import { create } from "./impl"; export { create }` or
  // `export const create = impl.create` re-exports without an export-from).
  // A dynamic `import()` / `require()` / `import x = require()` is a module
  // reference discovery cannot bind; it fails closed.
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const specifier = stringLiteralText(statement.moduleSpecifier);
      if (specifier === undefined) return false;
      specifiers.push(specifier);
    }
  }
  for (const binding of collectImportBindings(sourceFile)) {
    specifiers.push(binding.moduleSpecifier);
  }
  for (const { specifier } of collectDynamicModuleReferences(sourceFile)) {
    if (
      specifier === undefined ||
      specifier.startsWith(".") ||
      specifier === "convex/server"
    ) {
      return false;
    }
  }
  for (const specifier of new Set(specifiers)) {
    if (!specifier.startsWith(".")) {
      if (specifier === "convex/server") return false;
      continue;
    }
    const target = locateExternalSourceFile(
      repoRoot,
      path.relative(repoRoot, absolutePath),
      specifier,
    );
    if (
      !target ||
      !externalModuleIsBuilderFree(target, repoRoot, readSource, visited, depth + 1)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Module references made outside an `import` declaration: `import(<spec>)`,
 * `require(<spec>)`, and `import x = require(<spec>)`. Each is a way to obtain
 * a builder, `api`, or the CORS factory that `collectImportBindings` cannot
 * bind to a local name, so the callers fail closed on any of them that name
 * (or may name — a non-literal specifier) a module they guard (round 6).
 */
function collectDynamicModuleReferences(
  sourceFile: ts.SourceFile,
): { node: ts.Node; specifier: string | undefined }[] {
  const references: { node: ts.Node; specifier: string | undefined }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        references.push({
          node,
          specifier: stringLiteralText(node.moduleReference.expression),
        });
      }
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      references.push({
        node,
        specifier: node.arguments[0]
          ? stringLiteralText(node.arguments[0])
          : undefined,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

/**
 * Discover exported public Convex functions and destructured framework
 * registrar exports in one source file.
 *
 * Discovery is a whitelist of spellings it can resolve; everything else that
 * touches a registration builder is reported as `notStaticallyResolvable`
 * (round 4), and every place a builder or the module it came from can be
 * rebound, re-exported, or reassigned is covered too (round 5):
 *
 *  - the builder import is matched by RESOLVING its specifier to
 *    `_generated/server`, so `../_generated/./server` counts and a shim module
 *    does not; a shim (`export { mutation } from "./_generated/server"`,
 *    `export * from ...`) is itself unresolvable;
 *  - a builder rebound to a local (`const m = mutation`), a builder-bearing
 *    namespace escaping a plain property read (`const { mutation } = server`),
 *    or a builder call outside any exported registration is unresolvable;
 *  - an exported `let` / `var`, and any assignment to an exported top-level
 *    binding, is unresolvable — Convex registers the binding's FINAL value;
 *  - a re-export (`export { x } from`, `export *`, an import re-exported by
 *    name or as default, `export const y = importedX`) is resolved: a known
 *    convex module is skipped (its own discovery covers it), a bare package
 *    is skipped, and anything else is read from disk and fails closed unless
 *    it provably imports no builder.
 */
export function collectConvexIngressFromSource(
  filePath: string,
  source: string,
  options: IngressDiscoveryOptions = {},
): IngressRegistration[] {
  if (isExcludedConvexSourcePath(filePath)) return [];

  const sourceFile = parseSource(filePath, source);
  const convexPath = toConvexRelativePath(filePath);
  const names = getConvexRegistrationNames(sourceFile, (specifier) =>
    isGeneratedServerSpecifier(convexPath, specifier),
  );
  const wrapperNames = collectWrapperNames(sourceFile, convexPath);
  const moduleName = toConvexModuleName(filePath);
  const normalized = normalizeRepoPath(filePath);
  const registrarLocals = collectRegistrarLocalNames(sourceFile);
  const importBindings = collectImportBindings(sourceFile);
  const importByLocal = new Map(
    importBindings.map((binding) => [binding.local, binding]),
  );
  const readSource = options.readSource ?? defaultReadSource;
  const found: IngressRegistration[] = [];

  const push = (
    exportName: string,
    node: ts.Node,
    kind: IngressKind,
    call: ts.CallExpression,
  ) => {
    const outcome = matchHandlerGrammar(handlerExpression(call), wrapperNames);
    const match = outcome.match;
    found.push({
      id: `${moduleName}:${exportName}`,
      kind,
      filePath: normalized,
      line: lineOf(sourceFile, node),
      moduleName,
      exportName,
      wrapper: match?.wrapper,
      wrapperOffComposition: match ? !match.fromRoot : undefined,
      wrapperShape: outcome.reason,
      definitionReference: match?.definition,
      // Only the accepted grammar is admission. A wrapper spelled any other
      // way is unadmitted AND raises its own `wrapper-shape` finding.
      admitted: Boolean(match),
    });
  };

  /**
   * An exported binding that mentions a builder but is not one of the shapes
   * discovery resolves. It is ingress as far as Convex is concerned — Convex
   * registers whatever the export evaluates to — so it is reported as ingress
   * that can never be admitted, rather than skipped.
   */
  const pushUnresolvable = (
    exportName: string,
    node: ts.Node,
    kind: IngressKind,
    reason: string,
  ) => {
    found.push({
      id: `${moduleName}:${exportName}`,
      kind,
      filePath: normalized,
      line: lineOf(sourceFile, node),
      moduleName,
      exportName,
      admitted: false,
      notStaticallyResolvable: reason,
    });
  };

  /**
   * Every node discovery has accounted for. After the export pass, any
   * builder reference or namespace escape NOT under one of these is a use of
   * the builders that no exported registration explains — a rebinding, a
   * helper that builds registrations, an assignment — and is unresolvable.
   */
  const consumed = new Set<ts.Node>();
  const consume = (node: ts.Node | undefined) => {
    if (!node) return;
    const visit = (current: ts.Node) => {
      consumed.add(current);
      ts.forEachChild(current, visit);
    };
    visit(node);
  };

  /**
   * Classify one exported value. Only `<builder>({...})` — after peeling
   * type-only wrappers — is a registration; any other expression that mentions
   * a builder is unresolvable.
   */
  const classify = (
    exportName: string,
    node: ts.Node,
    initializer: ts.Expression | undefined,
    context: string,
  ) => {
    consume(initializer);
    const registration = matchRegistrationCall(initializer, names);
    if (registration) {
      push(exportName, node, registration.kind, registration.call);
      return;
    }
    const referenced = initializer
      ? findBuilderReference(initializer, names)
      : undefined;
    if (referenced) {
      pushUnresolvable(
        exportName,
        node,
        referenced,
        isRawHttpBuilderKind(referenced)
          ? `${context} references the raw HTTP builder (\`httpAction\` / \`httpActionGeneric\`); ${RAW_HTTP_BUILDER_REASON}`
          : `${context} references a registration builder but is ${initializer ? describeExpressionForOperator(unwrapTypeOnly(initializer)) : "uninitialized"} rather than a direct \`<builder>({...})\` call, so discovery cannot resolve what Convex registers under this name`,
      );
    }
  };

  /**
   * What discovery does with a value re-exported from another module: skip it
   * (a known convex module's own discovery covers it; a bare package cannot
   * be a registration), or fail closed with a reason.
   */
  const reexportDisposition = (
    specifier: string,
    importedName: string,
  ): string | undefined => {
    if (!specifier.startsWith(".")) {
      if (
        specifier === "convex/server" &&
        (importedName === "*" || CONVEX_SERVER_GENERIC_BUILDERS[importedName])
      ) {
        return "re-exports a generic registration builder from `convex/server`, which turns this module into a builder source discovery cannot follow";
      }
      return undefined;
    }
    const resolved = resolveModuleSpecifier(
      convexPath,
      specifier,
      options.knownConvexPaths,
    );
    if (!resolved) return undefined;
    if (resolved === GENERATED_SERVER_CONVEX_PATH) {
      return "re-exports from `_generated/server`, so it hands the registration builders themselves to every importer under a specifier discovery cannot resolve to the builder module";
    }
    if (!escapesConvexTree(resolved)) {
      if (!options.knownConvexPaths || options.knownConvexPaths.has(resolved)) {
        return undefined;
      }
    }
    if (!options.repoRoot) {
      return `re-exports from \`${specifier}\`, which is not a discovered convex module and cannot be read without a repository root`;
    }
    const located = locateExternalSourceFile(
      options.repoRoot,
      normalized,
      specifier,
    );
    if (!located) {
      return `re-exports from \`${specifier}\`, which is not a discovered convex module and could not be located on disk`;
    }
    if (externalModuleIsBuilderFree(located, options.repoRoot, readSource)) {
      return undefined;
    }
    return `re-exports from \`${specifier}\`, a module outside the discovered convex tree that imports a registration builder; whatever it exports under this name may be a public function discovery cannot see`;
  };

  // Top-level bindings, exported or not, so `export { a }` / `export default a`
  // can be resolved to the declaration they name.
  const topLevelBindings = new Map<
    string,
    { declaration: ts.VariableDeclaration; exported: boolean; isConst: boolean }
  >();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst =
      (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        topLevelBindings.set(declaration.name.text, {
          declaration,
          exported: hasExportModifier(statement),
          isConst,
        });
      }
    }
  }

  // Every top-level name that reaches the module's export surface, so a later
  // assignment to it can be reported.
  const exportedLocals = new Set<string>();
  for (const [name, binding] of topLevelBindings) {
    if (binding.exported) exportedLocals.add(name);
  }
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedLocals.add(element.propertyName?.text ?? element.name.text);
      }
    }
    if (ts.isExportAssignment(statement)) {
      const expression = unwrapTypeOnly(statement.expression);
      if (ts.isIdentifier(expression)) exportedLocals.add(expression.text);
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      if (!hasExportModifier(statement)) continue;
      const isConst =
        (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;

        // export let / export var: Convex registers the binding's value at
        // module end, and a `let` can be reassigned anywhere in between.
        if (!isConst) {
          consume(declaration);
          const bound = new Set<string>();
          bindingNameTexts(declaration.name, bound);
          const kind = findBuilderReference(declaration, names) ?? "mutation";
          for (const name of bound) {
            pushUnresolvable(
              name,
              declaration,
              kind,
              "the exported binding is declared with `let` / `var`, so it can be reassigned after its initializer and Convex registers whatever it holds at module end; only `const` exports are statically resolvable",
            );
          }
          continue;
        }

        // export const { auth, signIn, ... } = convexAuth({...})
        if (
          ts.isObjectBindingPattern(declaration.name) &&
          initializer &&
          ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          registrarLocals.has(initializer.expression.text)
        ) {
          consume(declaration);
          for (const element of declaration.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            found.push({
              id: `${moduleName}:${element.name.text}`,
              kind: "registrar",
              filePath: normalized,
              line: lineOf(sourceFile, element),
              moduleName,
              exportName: element.name.text,
              admitted: false,
            });
          }
          continue;
        }

        // export const { a, b: c } = { a: mutation({...}), b: query({...}) }
        if (ts.isObjectBindingPattern(declaration.name)) {
          consume(declaration);
          const object =
            initializer && ts.isObjectLiteralExpression(unwrapTypeOnly(initializer))
              ? (unwrapTypeOnly(initializer) as ts.ObjectLiteralExpression)
              : undefined;
          for (const element of declaration.name.elements) {
            if (!ts.isIdentifier(element.name)) {
              const kind = findBuilderReference(declaration, names);
              if (kind) {
                pushUnresolvable(
                  element.name.getText(sourceFile),
                  element,
                  kind,
                  "the exported destructuring element is itself a nested pattern",
                );
              }
              continue;
            }
            const exportName = element.name.text;
            const sourceName = element.propertyName
              ? element.propertyName.getText(sourceFile)
              : exportName;
            const property = object?.properties.find(
              (candidate) =>
                ts.isPropertyAssignment(candidate) &&
                (ts.isIdentifier(candidate.name) ||
                  ts.isStringLiteral(candidate.name)) &&
                candidate.name.text === sourceName,
            ) as ts.PropertyAssignment | undefined;
            if (property && !element.dotDotDotToken && !element.initializer) {
              classify(
                exportName,
                element,
                property.initializer,
                "the exported destructuring element's object-literal value",
              );
              continue;
            }
            const kind = findBuilderReference(declaration, names);
            if (kind) {
              pushUnresolvable(
                exportName,
                element,
                kind,
                "the exported destructuring element does not map to a plain object-literal property holding a `<builder>({...})` call",
              );
            }
          }
          continue;
        }

        if (!ts.isIdentifier(declaration.name)) {
          consume(declaration);
          const kind = findBuilderReference(declaration, names);
          if (kind) {
            pushUnresolvable(
              declaration.name.getText(sourceFile),
              declaration,
              kind,
              "the exported binding is an array pattern",
            );
          }
          continue;
        }

        // export const y = importedX / importedNs.member — a re-export in
        // disguise; resolve where the value comes from.
        const chain = initializer ? unwrapTypeOnly(initializer) : undefined;
        if (chain && isDottedIdentifierChain(chain)) {
          const { root, path: memberPath } = toDefinitionReference(chain);
          const binding = importByLocal.get(root);
          if (binding && !topLevelBindings.has(root)) {
            const importedName =
              binding.imported === "*"
                ? (memberPath[0] ?? "*")
                : binding.imported;
            const why = reexportDisposition(binding.moduleSpecifier, importedName);
            if (why) {
              consume(declaration);
              pushUnresolvable(
                declaration.name.text,
                declaration,
                "mutation",
                `the exported binding is initialized from the import \`${root}\`, which ${why}`,
              );
              continue;
            }
          }
        }

        classify(
          declaration.name.text,
          declaration,
          initializer,
          "the exported binding's initializer",
        );
      }
      continue;
    }

    // export default <builder>({...}) | export default <local> | <import>
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expression = unwrapTypeOnly(statement.expression);
      if (ts.isIdentifier(expression) && topLevelBindings.has(expression.text)) {
        const { declaration } = topLevelBindings.get(expression.text)!;
        classify(
          "default",
          statement,
          declaration.initializer,
          `the default export names the top-level binding \`${expression.text}\`, whose initializer`,
        );
        continue;
      }
      if (ts.isIdentifier(expression) && importByLocal.has(expression.text)) {
        const binding = importByLocal.get(expression.text)!;
        const why = reexportDisposition(binding.moduleSpecifier, binding.imported);
        if (why) {
          pushUnresolvable(
            "default",
            statement,
            "mutation",
            `the default export names the import \`${expression.text}\`, which ${why}`,
          );
        }
        continue;
      }
      classify(
        "default",
        statement,
        statement.expression,
        "the default export's expression",
      );
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      // `export type { X } from ...` erases; nothing is registered.
      if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier
        ? stringLiteralText(statement.moduleSpecifier)
        : undefined;

      // export * from "<spec>"
      if (!statement.exportClause) {
        const why =
          specifier === undefined
            ? "re-exports everything from a module specifier that is not a string literal"
            : reexportDisposition(specifier, "*");
        if (why) {
          pushUnresolvable(
            "*",
            statement,
            "mutation",
            `the star re-export ${why}`,
          );
        }
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) continue;

      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const local = element.propertyName?.text ?? element.name.text;
        const exportName = element.name.text;

        // export { a as b } from "<spec>"
        if (statement.moduleSpecifier) {
          const why =
            specifier === undefined
              ? "re-exports from a module specifier that is not a string literal"
              : reexportDisposition(specifier, local);
          if (why) {
            pushUnresolvable(
              exportName,
              element,
              "mutation",
              `the re-export of \`${local}\` ${why}`,
            );
          }
          continue;
        }

        // export { a, b as c } — local exports of top-level bindings ...
        const binding = topLevelBindings.get(local);
        if (binding) {
          classify(
            exportName,
            element,
            binding.declaration.initializer,
            `the local export names the top-level binding \`${local}\`, whose initializer`,
          );
          continue;
        }
        // ... or of import bindings (import-then-export).
        const imported = importByLocal.get(local);
        if (imported) {
          const why = reexportDisposition(imported.moduleSpecifier, imported.imported);
          if (why) {
            pushUnresolvable(
              exportName,
              element,
              "mutation",
              `the local export names the import \`${local}\`, which ${why}`,
            );
          }
        }
      }
    }
  }

  // Assignments to an exported top-level binding, anywhere in the module:
  // Convex registers the FINAL value, so the declaration's initializer is not
  // what gets registered.
  const sweep = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const target = unwrapTypeOnly(node.left);
      if (
        ts.isIdentifier(target) &&
        exportedLocals.has(target.text) &&
        !isShadowedReference(target)
      ) {
        consume(node.right);
        pushUnresolvable(
          target.text,
          node,
          findBuilderReference(node.right, names) ?? "mutation",
          `the exported binding \`${target.text}\` is assigned after its declaration, so Convex registers a value discovery cannot resolve from the declaration`,
        );
      }
    }
    ts.forEachChild(node, sweep);
  };
  sweep(sourceFile);

  // Builder references and namespace escapes nobody accounted for.
  const orphanBuilderReason = (kind: IngressKind, spelled: string, parent: ts.Node) =>
    isRawHttpBuilderKind(kind)
      ? `the raw HTTP builder \`${spelled}\` is referenced (\`${parent.getText(sourceFile).slice(0, 60)}\`); ${RAW_HTTP_BUILDER_REASON}`
      : `the registration builder \`${spelled}\` is referenced outside any exported registration (\`${parent.getText(sourceFile).slice(0, 60)}\`); a builder rebound to a local, passed to a helper, or called outside an exported \`<builder>({...})\` registers a function discovery cannot resolve`;
  const enclosingName = (node: ts.Node) => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isSourceFile(current)) {
      if (ts.isVariableDeclaration(current)) {
        const bound = new Set<string>();
        bindingNameTexts(current.name, bound);
        const [first] = bound;
        if (first) return first;
      }
      if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
      current = current.parent;
    }
    return `line-${lineOf(sourceFile, node)}`;
  };

  // Module references made outside an `import` declaration (round 6):
  // `await import("../_generated/server")`, `require("convex/server")`,
  // `import server = require(...)` obtain the builders under a binding
  // discovery cannot follow, and a non-literal specifier may name them.
  for (const { node, specifier } of collectDynamicModuleReferences(sourceFile)) {
    const namesBuilders =
      specifier === undefined ||
      specifier === "convex/server" ||
      isGeneratedServerSpecifier(convexPath, specifier) ||
      isTsconfigAliasSpecifier(specifier);
    if (!namesBuilders) continue;
    consume(node);
    pushUnresolvable(
      enclosingName(node),
      node,
      "mutation",
      specifier === undefined
        ? `the module reference \`${node.getText(sourceFile).slice(0, 60)}\` has a non-literal specifier, so it may load \`_generated/server\` or \`convex/server\` and hand the registration builders to a binding discovery cannot follow`
        : isTsconfigAliasSpecifier(specifier)
          ? `the module reference \`${node.getText(sourceFile).slice(0, 60)}\` uses a tsconfig \`paths\` alias (\`~/\`, \`@/\`, \`@cvx/\`) that the Convex bundler does not resolve inside convex/**, so what it loads is not statically resolvable`
          : `the module reference \`${node.getText(sourceFile).slice(0, 60)}\` loads the registration builders outside an \`import\` declaration, so they reach a binding discovery cannot follow`,
    );
  }
  // A tsconfig `paths` alias in an `import` declaration (round 7): the
  // webapp tsconfig declares `~/*`, `@/*`, `@cvx/*`, but convex/tsconfig.json
  // declares none and the bundler resolves none of them inside convex/**, so
  // an alias import is a module reference the runtime cannot follow — and it
  // may name `_generated/server` (`@cvx/_generated/server`,
  // `~/convex/_generated/server`). Fail closed on the declaration itself.
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isTsconfigAliasSpecifier(statement.moduleSpecifier.text) &&
      statement.importClause &&
      !statement.importClause.isTypeOnly
    ) {
      consume(statement);
      pushUnresolvable(
        enclosingName(statement),
        statement,
        "mutation",
        `the import \`${statement.moduleSpecifier.text}\` uses a tsconfig \`paths\` alias (\`~/\`, \`@/\`, \`@cvx/\`); convex/tsconfig.json declares no \`paths\` and the Convex bundler does not resolve them inside convex/**, so the module it names — possibly \`_generated/server\` — is not statically resolvable; spell it as a relative import`,
      );
    }
  }

  const orphan = (node: ts.Node) => {
    if (consumed.has(node)) return;
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      if (isNamespaceEscape(node, names)) {
        pushUnresolvable(
          enclosingName(node),
          node,
          "mutation",
          `the builder-bearing namespace import \`${node.text}\` is used other than as a plain property read (\`${node.parent.getText(sourceFile).slice(0, 60)}\`), which hands the registration builders to a spelling discovery cannot follow`,
        );
        return;
      }
      if (!isValueReference(node)) return;
      const kind = builderReferenceKind(node, names);
      if (kind) {
        pushUnresolvable(
          enclosingName(node),
          node,
          kind,
          orphanBuilderReason(kind, node.text, node.parent),
        );
      }
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const kind = builderReferenceKind(node, names);
      if (kind) {
        pushUnresolvable(
          enclosingName(node),
          node,
          kind,
          orphanBuilderReason(kind, node.getText(sourceFile), node.parent),
        );
        return;
      }
      orphan(node.expression);
      return;
    }
    ts.forEachChild(node, orphan);
  };
  orphan(sourceFile);

  return found;
}

function collectRegistrarLocalNames(sourceFile: ts.SourceFile) {
  const locals = new Set<string>();
  for (const binding of collectImportBindings(sourceFile)) {
    if (
      binding.moduleSpecifier === "@convex-dev/auth/server" &&
      binding.imported === "convexAuth"
    ) {
      locals.add(binding.local);
    }
  }
  return locals;
}

// ---------------------------------------------------------------------------
// Hono route discovery
// ---------------------------------------------------------------------------

type RouterNode = {
  key: string;
  convexPath: string;
  variableName: string;
};

type RawRouteRegistration = {
  routerKey: string;
  method: string;
  localPath: string;
  filePath: string;
  line: number;
  handler?: ts.Expression;
  admitted: boolean;
  wrapper?: string;
  wrapperFromRoot: boolean;
  wrapperKind?: IngressKind;
  /** Why the grammar rejected this handler — see `matchHandlerGrammar`. */
  wrapperShape?: string;
  definitionReference?: DefinitionReference;
};

/**
 * A router-method call the checker could not resolve to a route it can judge:
 * unknown receiver, non-literal path or method list, `.mount`, a `.route` whose
 * child is not an identifier. Each one is a high finding — a spelling the
 * checker cannot follow is a failure, not a pass.
 */
export type UnresolvableRouteRegistration = {
  filePath: string;
  line: number;
  method: string;
  reason: string;
  /** Finding label when the site is not a `.method(...)` call (round 7: a router reference). */
  label?: string;
};

type RouterMount = {
  parentKey: string;
  prefix: string;
  childRef: { local: string; convexPath: string };
};

type RouteModuleFacts = {
  routers: RouterNode[];
  registrations: RawRouteRegistration[];
  mounts: RouterMount[];
  /** exported name -> local router variable name */
  exportedRouters: Map<string, string>;
  /** `export * from "./x"` targets, convex-relative. */
  starReexports: string[];
  /** `export { a } from "./x"` — exported name -> {convexPath, imported} */
  namedReexports: Map<string, { convexPath: string; imported: string }>;
  addHttpRoutesCalls: { line: number }[];
  unresolvable: UnresolvableRouteRegistration[];
  /**
   * Every top-level name that IS a router in this module: the Hono router
   * variables and candidates (`routers`), plus the Convex `HttpRouterWithHono`
   * wrapper (`const http = new HttpRouterWithHono(app)`), which carries the
   * Hono app and a raw `.route({...})` registrar of its own. The router
   * reference sweep (round 7) treats a value reference to any of these
   * outside the accepted shapes as unresolvable.
   */
  routerLikeLocals: Set<string>;
};

/**
 * `new Map()` / `new Set()` / `new Headers()` and friends: constructor results
 * whose `get` / `delete` share the verb names but that are not routers. A
 * receiver bound to one is judged as the plain object it is (round 6 positive
 * control); any other `new` / call result is unresolvable (round 7).
 */
const RESOLVABLE_CONSTRUCTORS = new Set([
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Headers",
  "URLSearchParams",
  "URL",
  "Date",
  "FormData",
]);

/**
 * Global value roots a plain property chain may hang off (`Reflect.get(o, k)`,
 * `Object.entries(x)`, `Promise.all([...])`, `crypto.subtle`, ...). A chain
 * rooted at any OTHER undeclared identifier — `globalThis`, `self`, `window`,
 * a name the module never declares — is unresolvable (round 7).
 */
const RESOLVABLE_GLOBAL_ROOTS = new Set([
  "Object",
  "Array",
  "Promise",
  "JSON",
  "Math",
  "Date",
  "Number",
  "String",
  "Boolean",
  "Symbol",
  "Reflect",
  "Map",
  "Set",
  "console",
  "crypto",
  "Buffer",
  "Response",
  "Request",
  "Headers",
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
  "Error",
  "Intl",
  "BigInt",
  "Uint8Array",
  "process",
  "Deno",
]);

function isResolvableConstruction(node: ts.NewExpression) {
  return (
    ts.isIdentifier(node.expression) &&
    RESOLVABLE_CONSTRUCTORS.has(node.expression.text)
  );
}

/**
 * The router a receiver denotes among `routerNames`: the identifier itself,
 * or a chained registration call on one (`app.get('/a', h1).get('/b', h2)` —
 * every Hono registration method returns the router, so the receiver of the
 * second `.get` is still `app`). `(sub)`, `sub!`, `(sub as Hono)` are the same
 * router.
 */
function resolveRouterReceiverAmong(
  expression: ts.Expression,
  routerNames: ReadonlySet<string>,
): string | undefined {
  const receiver = unwrapTypeOnly(expression);
  if (ts.isIdentifier(receiver)) {
    return routerNames.has(receiver.text) ? receiver.text : undefined;
  }
  if (
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    ROUTER_METHODS.has(receiver.expression.name.text) &&
    receiver.expression.name.text !== "mount"
  ) {
    return resolveRouterReceiverAmong(
      receiver.expression.expression,
      routerNames,
    );
  }
  return undefined;
}

/**
 * The method a call's callee names, by property access OR element access
 * (`x.get(...)` and `x["get"](...)` are the same call; round 7), with the
 * receiver. A computed index (`x[verb](...)`) yields `method: undefined`.
 */
function calleeMember(
  callee: ts.Expression,
): { method: string | undefined; receiver: ts.Expression; computed: boolean } | undefined {
  if (ts.isPropertyAccessExpression(callee)) {
    return { method: callee.name.text, receiver: callee.expression, computed: false };
  }
  if (ts.isElementAccessExpression(callee)) {
    const literal = stringLiteralText(callee.argumentExpression);
    return {
      method: literal,
      receiver: callee.expression,
      computed: literal === undefined,
    };
  }
  return undefined;
}

function isHonoRouterDeclaration(declaration: ts.VariableDeclaration) {
  const typeName = declaration.type
    ? declaration.type.getText()
    : undefined;
  if (typeName && /^(Hono|HonoWithConvex)\b/.test(typeName.trim())) return true;
  const initializer = declaration.initializer;
  return Boolean(
    initializer &&
      ts.isNewExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === "Hono",
  );
}

/**
 * Router candidates beyond the `Hono` / `HonoWithConvex` spellings: a
 * top-level binding that is mounted with `.route(prefix, x)`, or that carries a
 * verb / `.on` / `.route` registration itself. A router produced by a factory
 * (`export const sub = createRouter()`) has neither the type nor the `new`, but
 * it is a router the moment a route is registered on it — so it is discovered
 * rather than dropped.
 */
function collectRouterCandidateNames(
  sourceFile: ts.SourceFile,
  topLevelNames: ReadonlySet<string>,
) {
  const candidates = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      const receiver = unwrapTypeOnly(node.expression.expression);
      if (method === "route" && node.arguments.length === 2) {
        const child = node.arguments[1];
        if (ts.isIdentifier(child) && topLevelNames.has(child.text)) {
          candidates.add(child.text);
        }
        if (ts.isIdentifier(receiver) && topLevelNames.has(receiver.text)) {
          candidates.add(receiver.text);
        }
      }
      const registers =
        (HTTP_VERBS.has(method) &&
          node.arguments.length >= 2 &&
          stringLiteralText(node.arguments[0]) !== undefined) ||
        (method === "on" && node.arguments.length >= 3);
      if (
        registers &&
        ts.isIdentifier(receiver) &&
        topLevelNames.has(receiver.text)
      ) {
        candidates.add(receiver.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

function collectRouteModuleFacts(
  module: ConvexModule,
  wrapperNames: WrapperNames,
  knownConvexPaths?: ReadonlySet<string>,
): RouteModuleFacts {
  const { sourceFile, convexPath, filePath } = module;
  const routers: RouterNode[] = [];
  const routerVariables = new Set<string>();
  const registrations: RawRouteRegistration[] = [];
  const mounts: RouterMount[] = [];
  const exportedRouters = new Map<string, string>();
  const starReexports: string[] = [];
  const namedReexports = new Map<
    string,
    { convexPath: string; imported: string }
  >();
  const addHttpRoutesCalls: { line: number }[] = [];
  const unresolvable: UnresolvableRouteRegistration[] = [];
  const importBindings = collectImportBindings(sourceFile);

  // Every top-level binding, destructured ones included (`const { r } = ...`
  // is a module-scoped name a router may be bound to; round 6).
  const topLevelNames = new Set<string>();
  // Top-level class / function / enum / namespace names: a chain rooted at one
  // (`Holder.r.get(...)`, `N.r.get(...)`) is a receiver the checker cannot see
  // into (round 7).
  const topLevelNonVariableNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNameTexts(declaration.name, topLevelNames);
      }
    } else if (
      (ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name &&
      ts.isIdentifier(statement.name)
    ) {
      topLevelNonVariableNames.add(statement.name.text);
    }
  }
  const candidateNames = collectRouterCandidateNames(sourceFile, topLevelNames);
  const routerLikeLocals = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer
          ? unwrapTypeOnly(declaration.initializer)
          : undefined;
        if (
          initializer &&
          ts.isNewExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          initializer.expression.text === "HttpRouterWithHono"
        ) {
          routerLikeLocals.add(declaration.name.text);
        }
        if (
          !isHonoRouterDeclaration(declaration) &&
          !candidateNames.has(declaration.name.text)
        ) {
          continue;
        }
        routerVariables.add(declaration.name.text);
        routerLikeLocals.add(declaration.name.text);
        routers.push({
          key: `${convexPath}#${declaration.name.text}`,
          convexPath,
          variableName: declaration.name.text,
        });
        if (hasExportModifier(statement)) {
          exportedRouters.set(declaration.name.text, declaration.name.text);
        }
      }
      continue;
    }

    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(unwrapTypeOnly(statement.expression))
    ) {
      // `export default http` — the root router module's own spelling.
      const name = (unwrapTypeOnly(statement.expression) as ts.Identifier).text;
      if (routerVariables.has(name)) exportedRouters.set("default", name);
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier
        ? stringLiteralText(statement.moduleSpecifier)
        : undefined;
      if (!statement.exportClause && specifier) {
        const target = resolveModuleSpecifier(
          convexPath,
          specifier,
          knownConvexPaths,
        );
        if (target) starReexports.push(target);
        continue;
      }
      if (
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (specifier) {
            const target = resolveModuleSpecifier(
              convexPath,
              specifier,
              knownConvexPaths,
            );
            if (target) {
              namedReexports.set(element.name.text, {
                convexPath: target,
                imported,
              });
            }
          } else if (routerVariables.has(imported)) {
            exportedRouters.set(element.name.text, imported);
          }
        }
      }
    }
  }

  /**
   * The router a receiver denotes: a router variable, or a chained call on one
   * (`app.get('/a', h1).get('/b', h2)` — every Hono registration method returns
   * the router, so the receiver of the second `.get` is still `app`).
   */
  const resolveRouterReceiver = (expression: ts.Expression) =>
    resolveRouterReceiverAmong(expression, routerVariables);

  /**
   * Does this call LOOK like a route registration or composition even though
   * its receiver did not resolve? A verb / `.route` / `.mount` whose first
   * argument is a string path plus a handler, or `.on` whose second argument
   * is one. Those are the Hono spellings, and on an unresolved receiver they
   * are a finding.
   *
   * Hono's `mergePath` prepends the slash itself, so `sub.get("evil", h)`
   * serves `GET /evil` exactly like `"/evil"`; requiring a leading `/` (round
   * 4) let a slash-less path escape. So: on a receiver that is an import
   * binding, a nested-scope local or parameter, or a paren / non-null /
   * element-access wrapper, ANY string or template first argument is a route
   * (`isUnresolvableReceiver`); those are the receivers a router reaches
   * this module through. Only on a plain property chain (`ctx.db`, whose
   * `get("table", id)` / `patch("table", id, ...)` share the verb names) does
   * the path still need to look like one (`/...` or `*`).
   */
  const isRoutePathLiteral = (node: ts.Expression | undefined) =>
    Boolean(
      node &&
        (stringLiteralText(node) !== undefined || ts.isTemplateExpression(node)),
    );
  const isSlashRoutePathLiteral = (node: ts.Expression | undefined) => {
    const text = stringLiteralText(node);
    if (text !== undefined) return /^[/*]/.test(text);
    return Boolean(
      node && ts.isTemplateExpression(node) && /^[/*]/.test(node.head.text),
    );
  };
  /**
   * The base of a receiver chain: `(sub).get(...).get(...)` -> `(sub)`,
   * `routers[0].post(...)` -> `routers[0]`.
   */
  const baseOfReceiver = (receiver: ts.Expression): ts.Expression => {
    let current = receiver;
    while (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ROUTER_METHODS.has(current.expression.name.text)
    ) {
      current = current.expression.expression;
    }
    return current;
  };
  /**
   * A receiver that is an IMPORT binding (a router declared in another
   * module, registered on from here), or a parenthesized / non-null /
   * type-asserted / element-access wrapper around anything, is a router the
   * checker cannot walk regardless of how the path is spelled: `sub.get(...)`
   * on an imported `sub` registers a live route on a router whose module is
   * walked from ITS declaration, and `(sub)` / `sub!` / `routers[0]` are the
   * same router behind a wrapper the resolver does not peel on purpose.
   */
  /**
   * The declaration a nested-scope identifier reference resolves to: the
   * nearest enclosing scope's parameter or variable of that name.
   */
  const nestedDeclarationOf = (
    reference: ts.Identifier,
  ): ts.ParameterDeclaration | ts.VariableDeclaration | undefined => {
    let current: ts.Node | undefined = reference.parent;
    while (current && !ts.isSourceFile(current)) {
      if (ts.isFunctionLike(current)) {
        for (const parameter of current.parameters) {
          const bound = new Set<string>();
          bindingNameTexts(parameter.name, bound);
          if (bound.has(reference.text)) return parameter;
        }
      }
      if (ts.isBlock(current) || ts.isCaseBlock(current) || ts.isModuleBlock(current)) {
        const statements = ts.isCaseBlock(current)
          ? current.clauses.flatMap((clause) => [...clause.statements])
          : [...current.statements];
        for (const statement of statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            const bound = new Set<string>();
            bindingNameTexts(declaration.name, bound);
            if (bound.has(reference.text)) return declaration;
          }
        }
      }
      current = current.parent;
    }
    return undefined;
  };
  /**
   * The top-level `VariableDeclaration` an identifier names, if any.
   */
  const topLevelDeclarationOf = (
    name: string,
  ): ts.VariableDeclaration | undefined => {
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        // A destructured top-level binding (`const { cache } = make()`) is
        // judged by the same initializer as a plain one (round 7).
        const bound = new Set<string>();
        bindingNameTexts(declaration.name, bound);
        if (bound.has(name)) return declaration;
      }
    }
    return undefined;
  };
  /**
   * Names bound INSIDE a function-like node (its parameters and every
   * declaration in its body), so a walk into it can tell a free variable —
   * one that reaches in from outside — from a local.
   */
  const namesBoundWithin = (fn: ts.Node): Set<string> => {
    const names = new Set<string>();
    const collect = (node: ts.Node) => {
      if (ts.isParameter(node) || ts.isVariableDeclaration(node)) {
        bindingNameTexts(node.name, names);
      } else if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isClassExpression(node)) &&
        node.name
      ) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, collect);
    };
    collect(fn);
    return names;
  };
  /**
   * Is a declaration INITIALIZER something a router may reach the receiver
   * through (round 6)? `const routers = { sub }`, `const alias = sub`,
   * `const [r] = [sub]`, `const alias = flag ? sub : other`,
   * `const alias = make()`, `const alias = list[0]` all bind an imported or
   * otherwise unresolvable router to a top-level name that is NOT itself a
   * router candidate — and `routers.sub.get('evil', h)` then registers a live
   * route the checker would otherwise judge under the slash-only rule. An
   * element access, a call, an `await`, or a `new` of anything but a plain
   * container (`Map`, `Set`, `Headers`, ...) is unresolvable outright; any
   * other expression is unresolvable when it MENTIONS (outside type positions)
   * an identifier that is itself an unresolvable receiver. Inside a nested
   * function — an object-literal getter / method / arrow property — only FREE
   * variables count (round 7: `{ get r() { return sub } }` reaches `sub`;
   * `{ get(table, id) { ... } }` reaches nothing).
   */
  const isUnresolvableInitializer = (
    initializer: ts.Expression,
    visiting: Set<ts.Node>,
  ): boolean => {
    const value = unwrapTypeOnly(initializer);
    if (ts.isIdentifier(value)) return isUnresolvableReceiver(value, visiting);
    if (ts.isNewExpression(value)) return !isResolvableConstruction(value);
    if (
      ts.isElementAccessExpression(value) ||
      ts.isCallExpression(value) ||
      ts.isAwaitExpression(value)
    ) {
      return true;
    }
    if (ts.isPropertyAccessExpression(value)) {
      return isUnresolvableReceiver(value, visiting);
    }
    let unresolvable = false;
    const walk = (node: ts.Node, bound: ReadonlySet<string>) => {
      if (unresolvable || ts.isTypeNode(node)) return;
      if (ts.isFunctionLike(node)) {
        // Descend, but only free variables can reach a router in here.
        const inner = new Set([...bound, ...namesBoundWithin(node)]);
        ts.forEachChild(node, (child) => walk(child, inner));
        return;
      }
      if (ts.isIdentifier(node)) {
        if (bound.has(node.text)) return;
        // A shorthand property (`{ sub }`) is a value reference to `sub`.
        const shorthand =
          ts.isShorthandPropertyAssignment(node.parent) &&
          node.parent.name === node;
        if (
          (shorthand || isValueReference(node)) &&
          isUnresolvableReceiver(node, visiting)
        ) {
          unresolvable = true;
        }
        return;
      }
      if (ts.isPropertyAccessExpression(node)) {
        let root: ts.Expression = node;
        while (ts.isPropertyAccessExpression(root)) {
          root = unwrapTypeOnly(root.expression);
        }
        if (ts.isIdentifier(root) && bound.has(root.text)) return;
        // `this.cache[...]` inside a method reads the literal itself.
        if (root.kind === ts.SyntaxKind.ThisKeyword) return;
        if (isUnresolvableReceiver(node, visiting)) unresolvable = true;
        return;
      }
      if (ts.isNewExpression(node)) {
        if (!isResolvableConstruction(node)) unresolvable = true;
        return;
      }
      if (
        ts.isElementAccessExpression(node) ||
        ts.isCallExpression(node) ||
        ts.isAwaitExpression(node)
      ) {
        unresolvable = true;
        return;
      }
      ts.forEachChild(node, (child) => walk(child, bound));
    };
    walk(value, new Set());
    return unresolvable;
  };
  /**
   * The root identifier of a property chain, or `undefined` when the chain is
   * rooted at something else (a call, a `new`, a conditional, ...).
   */
  const chainRootIdentifier = (
    expression: ts.Expression,
  ): ts.Identifier | undefined => {
    let root: ts.Expression = unwrapTypeOnly(expression);
    while (ts.isPropertyAccessExpression(root)) {
      root = unwrapTypeOnly(root.expression);
    }
    return ts.isIdentifier(root) ? root : undefined;
  };
  /**
   * Can this receiver be a router the checker was handed but cannot walk?
   *
   * The DEFAULT is yes (round 7): a receiver is resolvable only when it is a
   * shape the checker positively understands —
   *   - a router variable of this module (then it IS walked);
   *   - a top-level binding whose declaration initializer resolves (round 6);
   *   - a parameter typed `DatabaseReader` / `DatabaseWriter`, or the
   *     `<param>.db` chain of an untyped context parameter — the one documented
   *     disambiguation, because `ctx.db.get("table", id)` /
   *     `ctx.db.patch("table", id, ...)` share the verb names;
   *   - a nested local whose initializer resolves the same way;
   *   - a property chain rooted at a known global value (`Reflect`, `Object`,
   *     `Promise`, ...).
   * Everything else — an import binding, an element access, a call / `new` /
   * `await` / conditional / comma result, a chain rooted at a class, function,
   * enum, namespace, `globalThis`, or an undeclared name, an untyped
   * parameter, a top-level binding whose initializer is unresolvable — is
   * unresolvable, and a registration on it fails closed.
   */
  const isUnresolvableReceiver = (
    receiver: ts.Expression,
    visiting = new Set<ts.Node>(),
  ): boolean => {
    const base = baseOfReceiver(receiver);
    if (ts.isIdentifier(base)) {
      if (importBindings.some((binding) => binding.local === base.text)) {
        return true;
      }
      if (routerVariables.has(base.text)) return false;
      if (routerLikeLocals.has(base.text)) return true;
      if (isShadowedReference(base)) {
        // A nested declaration wins over any top-level name.
        return isUnresolvableNestedReference(base, visiting);
      }
      if (topLevelNames.has(base.text)) {
        // A top-level local that is not a router candidate: resolvable only
        // through its declaration's initializer (round 6 — an alias or a
        // container of an imported router is that router).
        const declaration = topLevelDeclarationOf(base.text);
        if (!declaration) return true;
        if (visiting.has(declaration)) return true;
        visiting.add(declaration);
        return declaration.initializer
          ? isUnresolvableInitializer(declaration.initializer, visiting)
          : true;
      }
      if (topLevelNonVariableNames.has(base.text)) return true;
      const nested = nestedDeclarationOf(base);
      if (nested) return isUnresolvableNestedReference(base, visiting);
      // Undeclared: a global. Only the known value roots are plain objects.
      return !RESOLVABLE_GLOBAL_ROOTS.has(base.text);
    }
    if (
      ts.isParenthesizedExpression(base) ||
      ts.isNonNullExpression(base) ||
      ts.isAsExpression(base) ||
      ts.isSatisfiesExpression(base) ||
      ts.isTypeAssertionExpression(base)
    ) {
      // `(ctx.db as any)` is still `ctx.db`; `(sub)` is still the import.
      return isUnresolvableReceiver(unwrapTypeOnly(base), visiting);
    }
    if (ts.isElementAccessExpression(base)) return true;
    if (ts.isNewExpression(base)) return !isResolvableConstruction(base);
    if (ts.isPropertyAccessExpression(base)) {
      const root = chainRootIdentifier(base);
      if (!root) return true;
      if (importBindings.some((binding) => binding.local === root.text)) {
        return true;
      }
      if (routerVariables.has(root.text)) return false;
      if (routerLikeLocals.has(root.text)) return true;
      if (isShadowedReference(root)) {
        return isUnresolvableNestedChain(base, root, visiting);
      }
      if (topLevelNames.has(root.text)) {
        return isUnresolvableReceiver(root, visiting);
      }
      if (topLevelNonVariableNames.has(root.text)) return true;
      if (nestedDeclarationOf(root)) {
        return isUnresolvableNestedChain(base, root, visiting);
      }
      return !RESOLVABLE_GLOBAL_ROOTS.has(root.text);
    }
    return true;
  };
  /** A bare identifier bound in a nested scope: parameter or local. */
  const isUnresolvableNestedReference = (
    reference: ts.Identifier,
    visiting: Set<ts.Node>,
  ): boolean => {
    const declaration = nestedDeclarationOf(reference);
    if (!declaration || visiting.has(declaration)) return true;
    visiting.add(declaration);
    if (ts.isParameter(declaration)) {
      // A parameter declared as a Convex database is the property chain it
      // is; any other parameter is a router the checker cannot see into.
      const typeText = declaration.type?.getText(sourceFile) ?? "";
      return !/\bDatabase(?:Reader|Writer)\b|\bGenericDatabase/.test(typeText);
    }
    return declaration.initializer
      ? isUnresolvableInitializer(declaration.initializer, visiting)
      : true;
  };
  /**
   * The parameter a nested-scope identifier ultimately aliases: itself, or —
   * through `const ctx = admittedCtx`, `const mutationCtx = ctx as
   * MutationCtx` — the parameter its initializer names. `undefined` when the
   * chain of aliases ends anywhere else.
   */
  const aliasedParameterOf = (
    reference: ts.Identifier,
    seen = new Set<ts.Node>(),
  ): ts.ParameterDeclaration | undefined => {
    const declaration = nestedDeclarationOf(reference);
    if (!declaration || seen.has(declaration)) return undefined;
    seen.add(declaration);
    if (ts.isParameter(declaration)) return declaration;
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      return undefined;
    }
    const value = unwrapTypeOnly(declaration.initializer);
    return ts.isIdentifier(value) ? aliasedParameterOf(value, seen) : undefined;
  };
  /**
   * A property chain rooted at a nested-scope binding. Off a parameter (or a
   * local that aliases one — `const ctx = admittedCtx`), a chain that passes
   * through a `db` segment (`ctx.db`, `args.ctx.db.system`) is the documented
   * Convex database disambiguation and a chain off a `Database*`-typed
   * parameter is too; any other chain off a parameter (`holder.r`) is
   * unresolvable — a router the checker cannot see into. A chain off a nested
   * local that aliases no parameter is judged by that local's initializer.
   */
  const isUnresolvableNestedChain = (
    chain: ts.PropertyAccessExpression,
    root: ts.Identifier,
    visiting: Set<ts.Node>,
  ): boolean => {
    const declaration = nestedDeclarationOf(root);
    if (!declaration) return true;
    const parameter = aliasedParameterOf(root);
    if (parameter) {
      const typeText = parameter.type?.getText(sourceFile) ?? "";
      if (/\bDatabase(?:Reader|Writer)\b|\bGenericDatabase/.test(typeText)) {
        return false;
      }
      let current: ts.Expression = chain;
      while (ts.isPropertyAccessExpression(current)) {
        if (current.name.text === "db") return false;
        current = unwrapTypeOnly(current.expression);
      }
      return true;
    }
    return isUnresolvableReceiver(root, visiting);
  };
  /**
   * Does this call LOOK like a route registration or composition even though
   * its receiver did not resolve? A verb / `.route` / `.mount` with (path,
   * handler) arity, `.on` with (methods, path, handler) arity, or a computed
   * method (`x[verb](...)`, round 7) with at least (path, handler). On a
   * module-scoped unresolvable receiver — an import binding, a top-level
   * alias / container that resolves to one, a class / namespace / global root
   * — EVERY registration-shaped call is a route, whatever the path expression
   * is (`alias.get(P, h)` with `const P = "evil"` serves `GET /evil`; round
   * 6). A parameter or nested local keeps the string / template rule.
   */
  const looksLikeRegistration = (
    method: string | undefined,
    node: ts.CallExpression,
    receiver: ts.Expression,
  ) => {
    const arity =
      method === undefined || HTTP_VERBS.has(method)
        ? node.arguments.length >= 2
        : method === "on"
          ? node.arguments.length >= 3
          : method === "route" || method === "mount"
            ? node.arguments.length === 2
            : false;
    if (!arity) return false;
    const pathArgument = node.arguments[method === "on" ? 1 : 0];
    if (!isUnresolvableReceiver(receiver)) {
      return isSlashRoutePathLiteral(pathArgument);
    }
    return isModuleScopedReceiver(receiver) || isRoutePathLiteral(pathArgument);
  };
  /**
   * Is the receiver's base an import binding, a top-level binding, a
   * top-level class / function / enum / namespace, or a global object root
   * (`globalThis`, `self`, `window`)?
   */
  const isModuleScopedReceiver = (receiver: ts.Expression): boolean => {
    const root = chainRootIdentifier(baseOfReceiver(receiver));
    if (!root || isShadowedReference(root)) return false;
    return (
      importBindings.some((binding) => binding.local === root.text) ||
      topLevelNames.has(root.text) ||
      topLevelNonVariableNames.has(root.text) ||
      root.text === "globalThis" ||
      root.text === "self" ||
      root.text === "window"
    );
  };

  const flaggedLines = new Set<number>();
  const flag = (
    node: ts.Node,
    method: string,
    reason: string,
    label?: string,
  ) => {
    const line = lineOf(sourceFile, node);
    // One finding per line: a router escaping through a spread AND a computed
    // method on the same statement is one site to fix.
    if (flaggedLines.has(line)) return;
    flaggedLines.add(line);
    unresolvable.push({
      filePath,
      line,
      method,
      reason,
      label,
    });
  };

  const register = (
    routerKey: string,
    node: ts.CallExpression,
    methods: string[],
    localPath: string,
    handlerIndex: number,
  ) => {
    const handler = node.arguments[node.arguments.length - 1];
    const middlewareCount = node.arguments.length - handlerIndex - 1;
    const outcome =
      middlewareCount > 0
        ? {
            reason: `the route registers ${middlewareCount} middleware handler(s) before the admitted handler; per-route middleware runs with the full ActionCtx before admission, so nothing may precede the wrapper in the argument list`,
          }
        : matchHandlerGrammar(handler, wrapperNames);
    const match = outcome.match;
    for (const httpMethod of methods) {
      registrations.push({
        routerKey,
        method: httpMethod,
        localPath,
        filePath,
        line: lineOf(sourceFile, node),
        handler,
        admitted: Boolean(match),
        wrapperShape: outcome.reason,
        wrapper: match?.wrapper,
        wrapperFromRoot: match?.fromRoot ?? true,
        wrapperKind: match?.kind,
        definitionReference: match?.definition,
      });
    }
  };

  // A router method READ that is not the callee of a call (`sub.get.call(sub,
  // ...)`, `sub.get.bind(sub)`, `Reflect.apply(sub.get, ...)`, `const g =
  // sub.get`) is caught by the router reference sweep: the router value in
  // receiver position of a member that is not a registration call is not an
  // accepted use. It is NOT judged here by receiver shape — `.get` / `.route`
  // / `.all` are ordinary property names (`definition.route`,
  // `internal.a.b.get`, `flags.all`), so a member read is a router escape
  // only when the receiver IS a router.
  const visit = (node: ts.Node) => {
    if (ts.isTypeNode(node)) return;
    const member = ts.isCallExpression(node)
      ? calleeMember(unwrapTypeOnly(node.expression))
      : undefined;
    if (ts.isCallExpression(node) && member) {
      const { method, receiver, computed } = member;

      if (method === "addHttpRoutes") {
        addHttpRoutesCalls.push({ line: lineOf(sourceFile, node) });
      }

      const routerName =
        method !== undefined && ROUTER_METHODS.has(method)
          ? resolveRouterReceiver(receiver)
          : undefined;
      const receiverIsRouter =
        routerName !== undefined ||
        resolveRouterReceiver(receiver) !== undefined;
      const spread = node.arguments.some((argument) =>
        ts.isSpreadElement(argument),
      );

      if (computed) {
        // `x[verb](...)`: the method is not statically known. On a router, or
        // on any unresolvable receiver with a registration-shaped argument
        // list, it may be a registration (round 7).
        if (
          receiverIsRouter ||
          (isUnresolvableReceiver(receiver) &&
            looksLikeRegistration(undefined, node, receiver))
        ) {
          flag(
            node,
            "[computed]",
            `a computed method \`${receiver.getText(sourceFile).slice(0, 40)}[${(node.expression as ts.ElementAccessExpression).argumentExpression.getText(sourceFile).slice(0, 30)}](...)\` is called on a router-like receiver; the checker cannot tell which registrar it names, so it is a route it cannot walk`,
          );
        }
      } else if (
        method !== undefined &&
        ROUTER_METHODS.has(method) &&
        spread &&
        (receiverIsRouter || isUnresolvableReceiver(receiver))
      ) {
        flag(
          node,
          method,
          `\`.${method}(...)\` is called with a spread argument, so neither the path nor the handler can be positioned; a registration the checker cannot position is a route it cannot walk`,
        );
      } else if (routerName === undefined) {
        if (
          method === "route" &&
          node.arguments.length === 1 &&
          stringLiteralText(node.arguments[0]) === undefined
        ) {
          // Convex's own `HttpRouter.route({ path, method, handler })` (which
          // `HttpRouterWithHono` extends) registers a raw `httpAction` route
          // beside the Hono app: a first-class ingress no Hono walk sees. Any
          // single-argument `.route(<non-string>)` on any receiver is that
          // registration until proven otherwise (round 6).
          flag(
            node,
            method,
            `\`.route(...)\` is called with a single non-string argument (\`${node.arguments[0].getText(sourceFile).slice(0, 60)}\`), the shape of Convex's \`HttpRouter.route({ path, method, handler })\`; a raw httpAction route registered beside the Hono app is an ingress the router walk never sees, so every HTTP route must be a Hono route under \`admitHttpRoute\` / \`admitHttpRead\``,
          );
        } else if (
          method !== undefined &&
          ROUTER_METHODS.has(method) &&
          looksLikeRegistration(method, node, receiver)
        ) {
          flag(
            node,
            method,
            `\`.${method}(...)\` is called on a receiver the checker cannot resolve to a router declared at the top level of this module (\`${receiver.getText(sourceFile).slice(0, 60)}\`); a route registered on an unknown router is never walked, so it must be spelled on a top-level router binding`,
          );
        }
      } else if (method !== undefined) {
        const routerKey = `${convexPath}#${routerName}`;

        if (method === "route") {
          const prefix = stringLiteralText(node.arguments[0]);
          const child = node.arguments[1];
          if (
            prefix === undefined ||
            node.arguments.length !== 2 ||
            !child ||
            !ts.isIdentifier(child)
          ) {
            flag(
              node,
              method,
              "`.route(prefix, child)` must take a string-literal prefix and a child router identifier; anything else cannot be walked to the routes it mounts",
            );
          } else {
            const binding = importBindings.find(
              (candidate) => candidate.local === child.text,
            );
            const targetPath = binding?.moduleSpecifier
              ? resolveModuleSpecifier(
                  convexPath,
                  binding.moduleSpecifier,
                  knownConvexPaths,
                )
              : convexPath;
            mounts.push({
              parentKey: routerKey,
              prefix,
              childRef: {
                local: binding?.imported ?? child.text,
                convexPath: targetPath ?? convexPath,
              },
            });
          }
        } else if (method === "mount") {
          flag(
            node,
            method,
            "`.mount(prefix, fetch)` hands every request under the prefix to a raw fetch handler the rail never sees; mount is not a route the checker can admit",
          );
        } else if (HTTP_VERBS.has(method)) {
          const localPath = stringLiteralText(node.arguments[0]);
          if (localPath === undefined || node.arguments.length < 2) {
            flag(
              node,
              method,
              `\`.${method}(path, handler)\` must take a string-literal path followed by the handler; a path held in a variable or template, or a handler-only registration, cannot be resolved to an ingress id`,
            );
          } else {
            register(
              routerKey,
              node,
              [method === "all" ? "ALL" : method.toUpperCase()],
              localPath,
              1,
            );
          }
        } else if (method === "on") {
          const methodsArg = node.arguments[0];
          const localPath = stringLiteralText(node.arguments[1]);
          const methods: string[] = [];
          let literalMethods = true;
          if (methodsArg && ts.isArrayLiteralExpression(methodsArg)) {
            for (const element of methodsArg.elements) {
              const text = stringLiteralText(element);
              if (text === undefined) literalMethods = false;
              else methods.push(text.toUpperCase());
            }
          } else {
            const single = stringLiteralText(methodsArg);
            if (single === undefined) literalMethods = false;
            else methods.push(single.toUpperCase());
          }
          if (
            !literalMethods ||
            methods.length === 0 ||
            localPath === undefined ||
            node.arguments.length < 3
          ) {
            flag(
              node,
              method,
              "`.on(methods, path, handler)` must take a string-literal method or an array literal of string-literal methods, a string-literal path, and the handler; anything else cannot be resolved to ingress ids",
            );
          } else {
            register(routerKey, node, methods, localPath, 2);
          }
        }
        // `.use` on a known router is router-level middleware; only the CORS
        // registration is inspected, by `assertCorsAllowlist`.
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    routers,
    registrations,
    mounts,
    exportedRouters,
    starReexports,
    namedReexports,
    addHttpRoutesCalls,
    unresolvable,
    routerLikeLocals,
  };
}

/**
 * Exported router name resolution across modules — `${convexPath}::${name}`
 * -> routerKey — with `export *` and `export { a } from` forwarding taken to
 * a fixpoint. (`export *` never forwards `default`.)
 */
function buildRouterExportIndex(facts: Map<string, RouteModuleFacts>) {
  const exportIndex = new Map<string, string>();
  for (const [convexPath, moduleFacts] of facts) {
    for (const [exportName, local] of moduleFacts.exportedRouters) {
      exportIndex.set(`${convexPath}::${exportName}`, `${convexPath}#${local}`);
    }
  }
  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false;
    for (const [convexPath, moduleFacts] of facts) {
      for (const target of moduleFacts.starReexports) {
        for (const [key, routerKey] of [...exportIndex]) {
          const [owner, name] = key.split("::");
          if (owner !== target || name === "default") continue;
          const forwarded = `${convexPath}::${name}`;
          if (!exportIndex.has(forwarded)) {
            exportIndex.set(forwarded, routerKey);
            changed = true;
          }
        }
      }
      for (const [exportName, ref] of moduleFacts.namedReexports) {
        const source = exportIndex.get(`${ref.convexPath}::${ref.imported}`);
        const forwarded = `${convexPath}::${exportName}`;
        if (source && !exportIndex.has(forwarded)) {
          exportIndex.set(forwarded, source);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return exportIndex;
}

/**
 * The router reference sweep (round 7) — the router-side mirror of the
 * consumed-builder orphan sweep. Seven review rounds each found the "next
 * ring" of registration spellings because the route walk keyed on ONE call
 * grammar (`<receiver>.<verb>(...)`) while a router VALUE can travel anywhere:
 * `sub["get"](...)`, `sub.get.call(sub, ...)`, `Reflect.apply(sub.get, ...)`,
 * `return sub`, `static r = sub`, `{ get r() { return sub } }`,
 * `globalThis.r = sub`, `helper(sub)`. So the rule is inverted: for every
 * import binding that resolves to an exported router of a convex module (or
 * a namespace import of a router-exporting module) and every router-like
 * local of this module, ANY value reference outside the accepted shapes is
 * `route-registration-not-statically-resolvable`. The accepted shapes are:
 *
 *   - the receiver of a `<router>.<verb | on | route | use | mount>(...)`
 *     call (the call itself is then judged by the walk);
 *   - the child argument of `.route(<prefix>, child)` on a router receiver;
 *   - the argument of `new HttpRouterWithHono(app)`;
 *   - the argument of `<registrar>.addHttpRoutes(http)`;
 *   - `export { x }` / `export default x` (not value references).
 *
 * A router that only ever appears in those positions is fully walked; one
 * that appears anywhere else has escaped into a spelling the walk cannot
 * follow, and the site fails closed.
 */
function sweepRouterReferences(
  module: ConvexModule,
  facts: RouteModuleFacts,
  exportIndex: ReadonlyMap<string, string>,
  knownConvexPaths: ReadonlySet<string>,
) {
  const { sourceFile, convexPath, filePath } = module;
  const routerish = new Set(facts.routerLikeLocals);
  const importDescriptions = new Map<string, string>();
  for (const binding of collectImportBindings(sourceFile)) {
    const target = resolveModuleSpecifier(
      convexPath,
      binding.moduleSpecifier,
      knownConvexPaths,
    );
    if (!target || !knownConvexPaths.has(target)) continue;
    const isRouter =
      binding.imported === "*"
        ? [...exportIndex.keys()].some((key) => key.startsWith(`${target}::`))
        : exportIndex.has(`${target}::${binding.imported}`);
    if (!isRouter) continue;
    routerish.add(binding.local);
    importDescriptions.set(
      binding.local,
      binding.imported === "*"
        ? `the namespace import of router module \`${target}\``
        : `the router \`${binding.imported}\` imported from \`${target}\``,
    );
  }
  if (routerish.size === 0) return;

  const routerNames = facts.routerLikeLocals;
  const isAcceptedUse = (identifier: ts.Identifier): boolean => {
    let expression: ts.Node = identifier;
    let parent: ts.Node = identifier.parent;
    while (
      ts.isParenthesizedExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTypeAssertionExpression(parent)
    ) {
      expression = parent;
      parent = parent.parent;
    }
    // Receiver of a router-method call.
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === expression &&
      ROUTER_METHODS.has(parent.name.text) &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.expression === parent
    ) {
      return true;
    }
    if (ts.isCallExpression(parent)) {
      const callee = unwrapTypeOnly(parent.expression);
      // Child of `.route(prefix, child)` on a router receiver.
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "route" &&
        parent.arguments.length === 2 &&
        parent.arguments[1] === expression &&
        resolveRouterReceiverAmong(callee.expression, routerNames) !== undefined
      ) {
        return true;
      }
      // `auth.addHttpRoutes(http)`.
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "addHttpRoutes" &&
        parent.arguments.length === 1 &&
        parent.arguments[0] === expression
      ) {
        return true;
      }
    }
    // `new HttpRouterWithHono(app)`.
    if (
      ts.isNewExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === "HttpRouterWithHono" &&
      parent.arguments?.length === 1 &&
      parent.arguments[0] === expression
    ) {
      return true;
    }
    // `export default app`.
    if (ts.isExportAssignment(parent)) return true;
    return false;
  };

  const flaggedLines = new Set(facts.unresolvable.map((site) => site.line));
  const walk = (node: ts.Node) => {
    if (ts.isTypeNode(node)) return;
    if (
      ts.isIdentifier(node) &&
      routerish.has(node.text) &&
      isValueReference(node) &&
      !isShadowedReference(node) &&
      !isAcceptedUse(node)
    ) {
      const line = lineOf(sourceFile, node);
      if (!flaggedLines.has(line)) {
        flaggedLines.add(line);
        const what =
          importDescriptions.get(node.text) ??
          `the router \`${node.text}\` declared in this module`;
        facts.unresolvable.push({
          filePath,
          line,
          method: "reference",
          label: `\`${node.text}\``,
          reason: `${what} is referenced as a value (\`${node.parent.getText(sourceFile).slice(0, 60)}\`) other than as the receiver of a registration, the child of \`.route(prefix, child)\`, the argument of \`new HttpRouterWithHono(...)\` / \`addHttpRoutes(...)\`, or an export; a router handed to any other spelling — a bracket callee, \`.call\` / \`.apply\`, a container, a getter, a return value, a global — can register routes the walk never sees`,
        });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
}

/**
 * Resolve every route registration to its full mounted path by walking the
 * router graph from `convex/http.ts`'s root router.
 */
function resolveRouteRegistrations(
  facts: Map<string, RouteModuleFacts>,
): { routes: IngressRegistration[]; registrations: Map<string, RawRouteRegistration> } {
  const exportIndex = buildRouterExportIndex(facts);

  const mountsByParent = new Map<string, RouterMount[]>();
  for (const moduleFacts of facts.values()) {
    for (const mount of moduleFacts.mounts) {
      const list = mountsByParent.get(mount.parentKey) ?? [];
      list.push(mount);
      mountsByParent.set(mount.parentKey, list);
    }
  }

  const registrationsByRouter = new Map<string, RawRouteRegistration[]>();
  for (const moduleFacts of facts.values()) {
    for (const registration of moduleFacts.registrations) {
      const list = registrationsByRouter.get(registration.routerKey) ?? [];
      list.push(registration);
      registrationsByRouter.set(registration.routerKey, list);
    }
  }

  const routes: IngressRegistration[] = [];
  const registrations = new Map<string, RawRouteRegistration>();
  const visited = new Set<string>();

  const walk = (routerKey: string, prefix: string) => {
    if (visited.has(`${routerKey}@${prefix}`)) return;
    visited.add(`${routerKey}@${prefix}`);

    for (const registration of registrationsByRouter.get(routerKey) ?? []) {
      const fullPath = joinRoutePath(prefix, registration.localPath);
      const kind: IngressKind = READ_METHODS.has(registration.method)
        ? "http_read"
        : "http";
      const id = `${registration.method} ${fullPath}`;
      routes.push({
        id,
        kind,
        filePath: registration.filePath,
        line: registration.line,
        moduleName: toConvexModuleName(registration.filePath),
        route: { method: registration.method, path: fullPath },
        wrapper: registration.wrapper,
        wrapperOffComposition: registration.wrapper
          ? !registration.wrapperFromRoot
          : undefined,
        wrapperShape: registration.wrapperShape,
        definitionReference: registration.definitionReference,
        admitted: registration.admitted,
      });
      registrations.set(id, registration);
    }

    for (const mount of mountsByParent.get(routerKey) ?? []) {
      const childKey =
        exportIndex.get(
          `${mount.childRef.convexPath}::${mount.childRef.local}`,
        ) ?? `${mount.childRef.convexPath}#${mount.childRef.local}`;
      walk(childKey, joinRoutePath(prefix, mount.prefix));
    }
  };

  const rootFacts = facts.get("http.ts");
  if (rootFacts) {
    for (const router of rootFacts.routers) walk(router.key, "");
  }

  // Any registration on a router never reached from the root still counts as
  // ingress — an unmounted route file is a discovery gap, not a pass.
  for (const [routerKey, list] of registrationsByRouter) {
    const reached = routes.some((route) =>
      list.some(
        (registration) =>
          registration.filePath === route.filePath &&
          registration.line === route.line &&
          registration.routerKey === routerKey,
      ),
    );
    if (reached) continue;
    for (const registration of list) {
      const id = `${registration.method} ${registration.localPath} (unmounted)`;
      routes.push({
        id,
        kind: READ_METHODS.has(registration.method) ? "http_read" : "http",
        filePath: registration.filePath,
        line: registration.line,
        moduleName: toConvexModuleName(registration.filePath),
        route: { method: registration.method, path: registration.localPath },
        wrapper: registration.wrapper,
        wrapperShape: registration.wrapperShape,
        definitionReference: registration.definitionReference,
        admitted: registration.admitted,
      });
      registrations.set(id, registration);
    }
  }

  routes.sort((left, right) => left.id.localeCompare(right.id));
  return { routes, registrations };
}

// ---------------------------------------------------------------------------
// api.* self-call ban
// ---------------------------------------------------------------------------

export type ApiSelfCallSite = {
  filePath: string;
  line: number;
  reference: string;
  via: string;
};

/**
 * Every string an expression can evaluate to, when that is statically
 * enumerable: string literals, templates over enumerable parts, conditionals
 * over enumerable branches, `null` / `undefined` (which stringify), and a
 * `const` declared exactly once in the file whose initializer is enumerable.
 * Anything else — a parameter, a call, a member read — is `undefined`: not
 * enumerable, so the caller fails closed.
 */
function possibleStringValues(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  visiting: Set<string> = new Set(),
): Set<string> | undefined {
  const node = unwrapTypeOnly(expression);
  const literal = stringLiteralText(node);
  if (literal !== undefined) return new Set([literal]);
  if (node.kind === ts.SyntaxKind.NullKeyword) return new Set(["null"]);
  if (ts.isIdentifier(node) && node.text === "undefined") {
    return new Set(["undefined"]);
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = possibleStringValues(node.whenTrue, sourceFile, visiting);
    const whenFalse = possibleStringValues(node.whenFalse, sourceFile, visiting);
    return whenTrue && whenFalse
      ? new Set([...whenTrue, ...whenFalse])
      : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    let values = new Set([node.head.text]);
    for (const span of node.templateSpans) {
      const part = possibleStringValues(span.expression, sourceFile, visiting);
      if (!part) return undefined;
      const next = new Set<string>();
      for (const prefix of values) {
        for (const value of part) next.add(`${prefix}${value}${span.literal.text}`);
      }
      values = next;
    }
    return values;
  }
  if (ts.isIdentifier(node)) {
    if (visiting.has(node.text)) return undefined;
    const declarations: ts.VariableDeclaration[] = [];
    const visit = (current: ts.Node) => {
      if (
        ts.isVariableDeclaration(current) &&
        ts.isIdentifier(current.name) &&
        current.name.text === node.text
      ) {
        declarations.push(current);
      }
      ts.forEachChild(current, visit);
    };
    visit(sourceFile);
    if (declarations.length !== 1) return undefined;
    const [declaration] = declarations;
    const list = declaration.parent;
    if (
      !ts.isVariableDeclarationList(list) ||
      (list.flags & ts.NodeFlags.Const) === 0 ||
      !declaration.initializer
    ) {
      return undefined;
    }
    visiting.add(node.text);
    return possibleStringValues(declaration.initializer, sourceFile, visiting);
  }
  return undefined;
}

/**
 * Resolve public-function references through AST bindings — import aliases,
 * namespace imports, intermediate consts, object destructuring, and object
 * literals — so an alias cannot smuggle a public self-call past the ban.
 *
 * Roots are `api` from `_generated/api` (the specifier RESOLVED, so
 * `../_generated/./api` counts) and the two first-class Convex spellings that
 * resolve the same public function without the generated object: `anyApi` and
 * `makeFunctionReference` from `convex/server`. A computed index on a root
 * (`api.a[name]`) is a site regardless of what the index evaluates to — fail
 * closed. Beyond the roots, every `run*` / `scheduler.run*` argument is judged
 * by `unresolvedReferenceReason` below: string and template references, hand-
 * built `Symbol.for("functionName")` objects, and chains rooted at an import
 * other than `internal` are sites too, so a module that never imports `api`
 * is still scanned. An `internal`-rooted chain is NOT trusted either (round
 * 6): `internal` is the same `anyApi` proxy as `api`, so its dotted path is
 * enumerated to `module/path:export` and is a site when it names a discovered
 * public function, or when a segment is computed.
 */
export function collectApiSelfCallSites(
  filePath: string,
  source: string,
  options: {
    /**
     * `module:export` ids of every discovered PUBLIC function. When given, a
     * `makeFunctionReference("module:export")` with a string-literal argument
     * is a site only if it names one of them (the same spelling also names
     * internal functions, which the ban does not cover). Without it, and for
     * any non-literal argument, the call is a site — fail closed.
     */
    publicFunctionNames?: ReadonlySet<string>;
  } = {},
): ApiSelfCallSite[] {
  if (isExcludedConvexSourcePath(filePath)) return [];
  const sourceFile = parseSource(filePath, source);
  const convexPath = toConvexRelativePath(filePath);
  const { publicFunctionNames } = options;

  const apiRoots = new Set<string>();
  const namespaceRoots = new Set<string>();
  const internalRoots = new Set<string>();
  const convexServerNamespaces = new Set<string>();
  const referenceFactories = new Set<string>();
  const importBindings = collectImportBindings(sourceFile);
  const importLocals = new Set(importBindings.map((binding) => binding.local));
  for (const binding of importBindings) {
    if (
      resolveModuleSpecifier(convexPath, binding.moduleSpecifier) ===
      GENERATED_API_CONVEX_PATH
    ) {
      if (binding.imported === "api") apiRoots.add(binding.local);
      if (binding.imported === "internal") internalRoots.add(binding.local);
      if (binding.imported === "*") namespaceRoots.add(binding.local);
      continue;
    }
    if (binding.moduleSpecifier === "convex/server") {
      if (binding.imported === "anyApi") apiRoots.add(binding.local);
      if (binding.imported === "makeFunctionReference") {
        referenceFactories.add(binding.local);
      }
      if (binding.imported === "*") convexServerNamespaces.add(binding.local);
    }
  }
  // No early return when no root is imported: a string function reference
  // (`ctx.runMutation("module:fn" as any, args)`) or a hand-built
  // `{ [Symbol.for("functionName")]: "module:fn" }` object reaches a public
  // function without touching `api` at all, and both are scanned below.

  const isReferenceFactory = (callee: ts.Expression) =>
    (ts.isIdentifier(callee) && referenceFactories.has(callee.text)) ||
    (ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      convexServerNamespaces.has(callee.expression.text) &&
      callee.name.text === "makeFunctionReference");

  const referenceText = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node)) {
      return apiRoots.has(node.text) ? node.text : undefined;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        if (
          namespaceRoots.has(node.expression.text) &&
          node.name.text === "api"
        ) {
          return `${node.expression.text}.api`;
        }
        if (
          convexServerNamespaces.has(node.expression.text) &&
          node.name.text === "anyApi"
        ) {
          return `${node.expression.text}.anyApi`;
        }
      }
      const parent = referenceText(node.expression);
      return parent ? `${parent}.${node.name.text}` : undefined;
    }
    if (ts.isElementAccessExpression(node)) {
      const parent = referenceText(node.expression);
      if (!parent) return undefined;
      const index = stringLiteralText(node.argumentExpression);
      // A non-literal index still selects SOME public function off the root.
      return index !== undefined
        ? `${parent}.${index}`
        : `${parent}[${node.argumentExpression.getText(sourceFile)}]`;
    }
    if (ts.isCallExpression(node) && isReferenceFactory(node.expression)) {
      // `makeFunctionReference<"mutation">("a:b")` resolves whatever function
      // the string names, public or internal, with no generated-object hop.
      // The name is a site unless EVERY value it can statically take names a
      // function that is not public; an argument the evaluator cannot
      // enumerate is a site.
      const possible = node.arguments[0]
        ? possibleStringValues(node.arguments[0], sourceFile)
        : undefined;
      if (
        possible &&
        publicFunctionNames &&
        [...possible].every((name) => !publicFunctionNames.has(name))
      ) {
        return undefined;
      }
      return `makeFunctionReference(${node.arguments[0]?.getText(sourceFile) ?? ""})`;
    }
    if (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isParenthesizedExpression(node)
    ) {
      return referenceText(node.expression);
    }
    return undefined;
  };

  /**
   * `{ [Symbol.for("functionName")]: "module:fn" }` IS a function reference at
   * runtime (`convex/server`'s `getFunctionName` reads exactly that global
   * registry symbol), built with no import at all.
   */
  const isFunctionNameSymbolKey = (name: ts.PropertyName) =>
    ts.isComputedPropertyName(name) &&
    /Symbol\s*\.\s*for\s*\(\s*["'`]functionName["'`]\s*\)/.test(
      name.expression.getText(sourceFile),
    );

  /**
   * Any element of this object / array literal (recursively, spreads
   * included) resolves to a root. A container holding a reference widens to
   * the whole container: any member read off it may be that reference.
   */
  const literalHoldsReference = (
    node: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression,
  ): boolean => {
    const holds = (value: ts.Expression): boolean => {
      const inner = unwrapTypeOnly(value);
      if (referenceText(inner) !== undefined) return true;
      if (
        ts.isObjectLiteralExpression(inner) ||
        ts.isArrayLiteralExpression(inner)
      ) {
        return literalHoldsReference(inner);
      }
      return false;
    };
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.some((element) =>
        ts.isSpreadElement(element) ? holds(element.expression) : holds(element),
      );
    }
    return node.properties.some((property): boolean => {
      if (ts.isPropertyAssignment(property)) {
        return (
          isFunctionNameSymbolKey(property.name) || holds(property.initializer)
        );
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return apiRoots.has(property.name.text);
      }
      if (ts.isSpreadAssignment(property)) {
        return holds(property.expression);
      }
      return false;
    });
  };

  // Widen the root set through local bindings until it stops growing.
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    const visitBindings = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const initializer = unwrapTypeOnly(node.initializer);
        const resolved =
          referenceText(initializer) !== undefined ||
          ((ts.isObjectLiteralExpression(initializer) ||
            ts.isArrayLiteralExpression(initializer)) &&
            literalHoldsReference(initializer));
        if (resolved) {
          // A plain name, or every name a binding pattern (object OR array,
          // round 7) takes off a resolved initializer, is a root.
          const bound = new Set<string>();
          bindingNameTexts(node.name, bound);
          for (const name of bound) {
            if (!apiRoots.has(name)) {
              apiRoots.add(name);
              changed = true;
            }
          }
        }
      }
      ts.forEachChild(node, visitBindings);
    };
    visitBindings(sourceFile);
    if (!changed) break;
  }

  /** The identifier at the root of a dotted / indexed chain, if any. */
  const chainRoot = (node: ts.Expression): ts.Identifier | undefined => {
    let current: ts.Expression = unwrapTypeOnly(node);
    for (;;) {
      if (ts.isIdentifier(current)) return current;
      if (
        ts.isPropertyAccessExpression(current) ||
        ts.isElementAccessExpression(current)
      ) {
        current = unwrapTypeOnly(current.expression);
        continue;
      }
      return undefined;
    }
  };

  /**
   * How many times a name is declared anywhere in the file (variables,
   * binding elements, parameters). A name declared more than once is not one
   * value, so a widened `internal` local under that name is `unknown`.
   */
  const declarationCounts = new Map<string, number>();
  const countDeclarations = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      const bound = new Set<string>();
      bindingNameTexts(node.name, bound);
      for (const name of bound) {
        declarationCounts.set(name, (declarationCounts.get(name) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, countDeclarations);
  };
  countDeclarations(sourceFile);

  /**
   * `internal` widened through local bindings, the way `api` is — but FAILING
   * CLOSED on loss of path (round 7). Each local bound to something rooted at
   * `internal` records either the dotted segment prefix it denotes (`const ex
   * = internal.a.b` -> `["a", "b"]`; a computed segment is `undefined`) or
   * `"unknown"`: a destructure (`const { example } = internal`), an object /
   * array / spread container (`{ w: internal.a.b }`, `[internal.a.b]`), a
   * conditional, a call, an `await`, any other expression that merely
   * mentions an internal root, or a name declared more than once in the
   * file. A run-call argument rooted at an `unknown` local is a site — the
   * checker cannot enumerate it against the public set — while a prefix local
   * is enumerated exactly like the import.
   */
  type InternalPrefix = (string | undefined)[] | "unknown";
  const internalLocals = new Map<string, InternalPrefix>();
  const isInternalRootName = (name: string) =>
    internalRoots.has(name) || namespaceRoots.has(name) || internalLocals.has(name);
  /** Segments after the internal root for a chain, or `undefined` / `unknown`. */
  const internalChainOf = (
    expression: ts.Expression,
  ): InternalPrefix | undefined => {
    const segments: (string | undefined)[] = [];
    let current: ts.Expression = unwrapTypeOnly(expression);
    for (;;) {
      if (ts.isPropertyAccessExpression(current)) {
        segments.unshift(current.name.text);
        current = unwrapTypeOnly(current.expression);
        continue;
      }
      if (ts.isElementAccessExpression(current)) {
        segments.unshift(stringLiteralText(current.argumentExpression));
        current = unwrapTypeOnly(current.expression);
        continue;
      }
      break;
    }
    if (!ts.isIdentifier(current)) return undefined;
    if (importLocals.has(current.text)) {
      if (internalRoots.has(current.text)) return segments;
      if (namespaceRoots.has(current.text) && segments[0] === "internal") {
        return segments.slice(1);
      }
      return undefined;
    }
    const local = internalLocals.get(current.text);
    if (local === undefined) return undefined;
    if (local === "unknown") return "unknown";
    return [...local, ...segments];
  };
  /** Does this expression mention an internal root anywhere (type positions aside)? */
  const mentionsInternalRoot = (node: ts.Node): boolean => {
    let found = false;
    const walk = (current: ts.Node) => {
      if (found || ts.isTypeNode(current)) return;
      if (ts.isIdentifier(current)) {
        const shorthand =
          ts.isShorthandPropertyAssignment(current.parent) &&
          current.parent.name === current;
        if (
          (shorthand || isValueReference(current)) &&
          isInternalRootName(current.text)
        ) {
          found = true;
        }
        return;
      }
      ts.forEachChild(current, walk);
    };
    walk(node);
    return found;
  };
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    const record = (name: string, value: InternalPrefix) => {
      const previous = internalLocals.get(name);
      if (previous === undefined || (previous !== "unknown" && value === "unknown")) {
        internalLocals.set(name, value);
        changed = true;
      }
    };
    const widen = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const chain = internalChainOf(node.initializer);
        const bound = new Set<string>();
        bindingNameTexts(node.name, bound);
        if (chain !== undefined) {
          const precise =
            ts.isIdentifier(node.name) &&
            chain !== "unknown" &&
            (declarationCounts.get(node.name.text) ?? 0) <= 1;
          for (const name of bound) record(name, precise ? chain : "unknown");
        } else if (mentionsInternalRoot(node.initializer)) {
          for (const name of bound) record(name, "unknown");
        }
      }
      ts.forEachChild(node, widen);
    };
    widen(sourceFile);
    if (!changed) break;
  }

  /**
   * Why a function-reference argument that is NOT an `api` root is still a
   * site (fail closed), or `undefined` when it is a spelling the ban accepts.
   *
   *  - a string literal / template IS a function reference at runtime
   *    (`getFunctionName`: "a string is always allowed at runtime"); it is a
   *    site when any value it can take names a public function, and when the
   *    checker cannot enumerate its values at all;
   *  - an object literal is a hand-built reference — a site;
   *  - a conditional is judged on both branches (round 7);
   *  - a chain rooted at an IMPORT binding must be rooted at `internal` from
   *    `_generated/api` (or a namespace import's `.internal`); any other
   *    imported root is a reference table the checker cannot see into;
   *  - an `internal`-rooted chain, through the import or a widened local, is
   *    enumerated against the public set; a widened local that lost its path
   *    (`unknown`) is a site;
   *  - a local `const` bound to one of the above is resolved through it;
   *  - any other non-call expression the checker cannot root (a comma, an
   *    `await`, a `??`, a chain off a call result) is a site (round 7).
   *
   * A parameter, a call result, or a local of unknown provenance is left to
   * the caller-table pass: the rail's own core forwards injected internal
   * references that way, and those are not statically nameable here.
   */
  const unresolvedReferenceReason = (
    argument: ts.Expression,
    visiting = new Set<string>(),
  ): string | undefined => {
    const node = unwrapTypeOnly(argument);
    if (stringLiteralText(node) !== undefined || ts.isTemplateExpression(node)) {
      const possible = possibleStringValues(node, sourceFile);
      if (!possible) {
        return `string function reference ${node.getText(sourceFile).slice(0, 60)} cannot be statically enumerated`;
      }
      if (!publicFunctionNames) {
        return `string function reference ${node.getText(sourceFile).slice(0, 60)}`;
      }
      const named = [...possible].filter((name) => publicFunctionNames.has(name));
      return named.length > 0
        ? `string function reference names public ${named.join(", ")}`
        : undefined;
    }
    if (ts.isObjectLiteralExpression(node)) {
      return "hand-built function reference object literal";
    }
    if (ts.isConditionalExpression(node)) {
      for (const branch of [node.whenTrue, node.whenFalse]) {
        const reference = referenceText(branch);
        if (reference) return `conditional function reference selects ${reference}`;
        const reason = unresolvedReferenceReason(branch, visiting);
        if (reason) return `conditional function reference: ${reason}`;
      }
      return undefined;
    }
    if (ts.isCallExpression(node)) return undefined;
    const root = chainRoot(node);
    if (!root) {
      return `function reference \`${node.getText(sourceFile).slice(0, 60)}\` has a shape the checker cannot root (not an identifier, dotted chain, string, or conditional)`;
    }
    // `internal` is `anyApi` at runtime — the SAME proxy as `api` — so a
    // chain rooted at it resolves whatever function its dotted path names,
    // public or internal (round 6). The path is enumerated to `a/b:c` and is a
    // site when it names a discovered public function; a computed segment
    // could name any of them and fails closed; a widened local that lost the
    // path (round 7) fails closed.
    const internalPath = internalChainOf(node);
    if (internalPath === "unknown") {
      return `internal-rooted reference \`${node.getText(sourceFile).slice(0, 60)}\` reaches \`internal\` through a destructure, container, conditional, call, or redeclared local, so its path cannot be enumerated against the public set`;
    }
    if (internalPath) {
      const spelled = node.getText(sourceFile).slice(0, 60);
      if (internalPath.some((segment) => segment === undefined)) {
        return `internal-rooted reference \`${spelled}\` has a computed segment, so it may name any function including a public one`;
      }
      const segments = internalPath as string[];
      if (segments.length >= 2 && publicFunctionNames) {
        const name = `${segments.slice(0, -1).join("/")}:${segments[segments.length - 1]}`;
        if (publicFunctionNames.has(name)) {
          return `internal-rooted reference \`${spelled}\` names public ${name} (\`internal\` is the same anyApi proxy as \`api\`)`;
        }
      }
      return undefined;
    }
    if (importLocals.has(root.text)) {
      if (internalRoots.has(root.text)) return undefined;
      if (namespaceRoots.has(root.text)) {
        // `generated.internal.x.y` is fine; `generated.api.x.y` was already a
        // site through referenceText, so any other member off the namespace
        // is an unknown reference.
        let base: ts.Expression = node;
        let member: string | undefined;
        while (
          ts.isPropertyAccessExpression(base) ||
          ts.isElementAccessExpression(base)
        ) {
          member = ts.isPropertyAccessExpression(base)
            ? base.name.text
            : stringLiteralText(base.argumentExpression);
          base = unwrapTypeOnly(base.expression);
        }
        return member === "internal"
          ? undefined
          : `reference rooted at the generated namespace \`${root.text}\` is not \`${root.text}.internal.*\``;
      }
      return `reference rooted at the import \`${root.text}\` is not \`internal.*\` from _generated/api, so the checker cannot see whether it names a public function`;
    }
    if (ts.isIdentifier(node) && !visiting.has(node.text)) {
      // A local const bound to a string / object / import chain.
      const declarations: ts.VariableDeclaration[] = [];
      const collect = (current: ts.Node) => {
        if (
          ts.isVariableDeclaration(current) &&
          ts.isIdentifier(current.name) &&
          current.name.text === node.text
        ) {
          declarations.push(current);
        }
        ts.forEachChild(current, collect);
      };
      collect(sourceFile);
      if (declarations.length === 1 && declarations[0].initializer) {
        visiting.add(node.text);
        return unresolvedReferenceReason(declarations[0].initializer, visiting);
      }
    }
    return undefined;
  };

  /**
   * The RUN site a call is, matched by the callee's NAME regardless of shape
   * (round 7): `ctx.runMutation(ref)`, `ctx["runMutation"](ref)`,
   * `<anything>.scheduler.runAfter(0, ref)` / `.runAt(t, ref)`,
   * `ctx.runMutation.call(ctx, ref)`, `ctx.runMutation.apply(ctx, [ref])`,
   * `Reflect.apply(ctx.runMutation, ctx, [ref])`, and a bare identifier
   * callee bound to a run method — a destructured parameter
   * (`({ runMutation }) => runMutation(ref)`), `const { runMutation } = ctx`,
   * `const r = ctx.runMutation` / `.bind(ctx)`. Returns the method, the
   * function-reference argument (when it can be positioned) and a fail-closed
   * reason when it cannot (`.apply(ctx, argsVar)`).
   */
  const memberName = (node: ts.Expression): string | undefined => {
    const value = unwrapTypeOnly(node);
    if (ts.isPropertyAccessExpression(value)) return value.name.text;
    if (ts.isElementAccessExpression(value)) {
      return stringLiteralText(value.argumentExpression);
    }
    return undefined;
  };
  const isRunName = (name: string | undefined): name is string =>
    name !== undefined && (RUN_METHODS.has(name) || SCHEDULER_METHODS.has(name));
  const argumentIndexFor = (method: string) =>
    SCHEDULER_METHODS.has(method) ? 1 : 0;
  /** A bare identifier bound to a run method anywhere in the file. */
  const runMethodBoundTo = (name: string): string | undefined => {
    let found: string | undefined;
    const search = (node: ts.Node) => {
      if (found) return;
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.name.text === name) {
        const property = node.propertyName
          ? ts.isIdentifier(node.propertyName)
            ? node.propertyName.text
            : stringLiteralText(node.propertyName)
          : node.name.text;
        if (isRunName(property)) found = property;
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer
      ) {
        const value = unwrapTypeOnly(node.initializer);
        const direct = memberName(value);
        if (isRunName(direct)) found = direct;
        else if (
          ts.isCallExpression(value) &&
          memberName(value.expression) === "bind"
        ) {
          const bound = memberName(
            (unwrapTypeOnly(value.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression,
          );
          if (isRunName(bound)) found = bound;
        }
      }
      ts.forEachChild(node, search);
    };
    search(sourceFile);
    return found;
  };
  const runCallShape = (
    node: ts.CallExpression,
  ): { method: string; argument?: ts.Expression; reason?: string } | undefined => {
    const callee = unwrapTypeOnly(node.expression);
    const name = memberName(callee);
    if (isRunName(name)) {
      return { method: name, argument: node.arguments[argumentIndexFor(name)] };
    }
    if (
      (name === "call" || name === "apply") &&
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
    ) {
      const target = memberName(callee.expression);
      if (isRunName(target)) {
        if (name === "call") {
          return {
            method: target,
            argument: node.arguments[argumentIndexFor(target) + 1],
          };
        }
        const list = node.arguments[1] ? unwrapTypeOnly(node.arguments[1]) : undefined;
        if (list && ts.isArrayLiteralExpression(list)) {
          const element = list.elements[argumentIndexFor(target)];
          return {
            method: target,
            argument: element && !ts.isSpreadElement(element) ? element : undefined,
            reason: element && ts.isSpreadElement(element)
              ? "`.apply` argument list spreads a value the checker cannot position"
              : undefined,
          };
        }
        return {
          method: target,
          reason: "`.apply` is handed an argument list the checker cannot see into",
        };
      }
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "Reflect" &&
      callee.name.text === "apply"
    ) {
      const target = node.arguments[0] ? memberName(node.arguments[0]) : undefined;
      if (isRunName(target)) {
        const list = node.arguments[2] ? unwrapTypeOnly(node.arguments[2]) : undefined;
        if (list && ts.isArrayLiteralExpression(list)) {
          const element = list.elements[argumentIndexFor(target)];
          return {
            method: target,
            argument: element && !ts.isSpreadElement(element) ? element : undefined,
            reason: element && ts.isSpreadElement(element)
              ? "`Reflect.apply` argument list spreads a value the checker cannot position"
              : undefined,
          };
        }
        return {
          method: target,
          reason: "`Reflect.apply` is handed an argument list the checker cannot see into",
        };
      }
    }
    if (ts.isIdentifier(callee)) {
      const bound = runMethodBoundTo(callee.text);
      if (bound) {
        return { method: bound, argument: node.arguments[argumentIndexFor(bound)] };
      }
    }
    return undefined;
  };

  const sites: ApiSelfCallSite[] = [];
  /** Run-call arguments already reported, so the reference sweep skips them. */
  const reportedArguments = new Set<ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const shape = runCallShape(node);
      if (shape) {
        const { method, argument } = shape;
        const reference = argument ? referenceText(argument) : undefined;
        if (reference) {
          reportedArguments.add(argument!);
          sites.push({
            filePath: normalizeRepoPath(filePath),
            line: lineOf(sourceFile, node),
            reference,
            via: method,
          });
        } else if (shape.reason) {
          sites.push({
            filePath: normalizeRepoPath(filePath),
            line: lineOf(sourceFile, node),
            reference: `${node.getText(sourceFile).slice(0, 80)} (${shape.reason})`,
            via: method,
          });
        } else if (argument) {
          const reason = unresolvedReferenceReason(argument);
          if (reason) {
            reportedArguments.add(argument);
            sites.push({
              filePath: normalizeRepoPath(filePath),
              line: lineOf(sourceFile, node),
              reference: `${argument.getText(sourceFile).slice(0, 80)} (${reason})`,
              via: method,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Round 7: ANY value reference to an `api` root — the import binding,
  // `anyApi`, `<ns>.api` off a `_generated/api` namespace import, a computed
  // member off that namespace, or a widened local — anywhere in the module is
  // a site, not only as a run-call argument. The real tree references `api`
  // nowhere under convex/**, so this costs nothing there and closes every
  // bracket / rebound / `.call` / destructured-context spelling for `api` in
  // one rule: the value cannot be obtained without being referenced.
  const isInsideReportedArgument = (node: ts.Node) => {
    let current: ts.Node | undefined = node;
    while (current && !ts.isSourceFile(current)) {
      if (reportedArguments.has(current)) return true;
      current = current.parent;
    }
    return false;
  };
  const sweep = (node: ts.Node) => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node) && isValueReference(node)) {
      const parent = node.parent;
      let spelled: string | undefined;
      if (apiRoots.has(node.text)) {
        spelled = node.text;
      } else if (namespaceRoots.has(node.text)) {
        // A plain `.internal` read is the accepted use of the namespace; a
        // `.api` read, a computed member, or the namespace value itself
        // escaping (`pick(generated)`, `const g = generated`) is not.
        const memberRead =
          (ts.isPropertyAccessExpression(parent) && parent.expression === node)
            ? parent.name.text
            : ts.isElementAccessExpression(parent) && parent.expression === node
              ? stringLiteralText(parent.argumentExpression) ?? "[computed]"
              : undefined;
        if (memberRead !== "internal") {
          spelled = memberRead === undefined ? node.text : `${node.text}.${memberRead}`;
        }
      } else if (
        convexServerNamespaces.has(node.text) &&
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.name.text === "anyApi"
      ) {
        spelled = `${node.text}.anyApi`;
      }
      if (spelled !== undefined && !isInsideReportedArgument(node)) {
        sites.push({
          filePath: normalizeRepoPath(filePath),
          line: lineOf(sourceFile, node),
          reference: `${spelled} (api root referenced as a value: \`${(parent.parent && !ts.isSourceFile(parent.parent) ? parent.parent : parent).getText(sourceFile).slice(0, 60)}\`)`,
          via: "reference",
        });
      }
    }
    ts.forEachChild(node, sweep);
  };
  sweep(sourceFile);
  return sites;
}

// ---------------------------------------------------------------------------
// CORS allowlist assertion
// ---------------------------------------------------------------------------

export type CorsAssertion = {
  /** A cors call (by any spelling) or a `hono/cors` import is present. */
  found: boolean;
  allowlisted: boolean;
  line?: number;
  detail: string;
};

/**
 * The router's CORS middleware is the ONLY `.use` the checker inspects: a
 * `SameSite=None` claim cookie plus a reflect-any-origin callback is a
 * cross-origin write primitive, so the origin must be a fixed allowlist.
 *
 * This is a whitelist too. `origin` is accepted only when it is statically an
 * allowlist: an array literal whose elements are string literals or spreads of
 * an allowlist source, or an allowlist source itself — where an allowlist
 * source is a name imported from `platform/storefrontOrigins.ts` (resolved,
 * not suffix-matched) or a zero-argument call to one. Any other identifier,
 * member, or call is not "a fixed value", it is a value the checker cannot
 * see (`const reflect = (o) => o; cors({ origin: reflect })` reflects every
 * origin). The module must register `cors(...)` exactly once, as an argument
 * of `<router>.use(...)`, with `cors` imported from `hono/cors`; a failing
 * assertion is never overwritten by a later passing call.
 *
 * "cors(...)" is matched by RESOLUTION, not by the identifier `cors`: the
 * named import under any local name, `<ns>.cors` off a namespace import of
 * `hono/cors`, and any local `const` bound to either (`const c2 = cors`,
 * `const { cors: c3 } = honoCors`) all count, and every one of them counts
 * toward the "exactly once" rule — Hono runs every registered middleware, so a
 * later `honoCors.cors({ origin: (o) => o })` reflects the origin regardless of
 * the allowlisted call before it. Any other use of a `hono/cors` binding
 * (passed to a helper, re-exported) is a spelling the checker cannot follow
 * and fails too. The main check runs this over EVERY module and requires the
 * `hono/cors` import to appear only in `http.ts`.
 */
export function assertCorsAllowlist(
  filePath: string,
  source: string,
): CorsAssertion {
  const sourceFile = parseSource(filePath, source);
  const convexPath = toConvexRelativePath(filePath);
  const failed = (line: number | undefined, detail: string): CorsAssertion => ({
    found: true,
    allowlisted: false,
    line,
    detail,
  });

  const bindings = collectImportBindings(sourceFile);
  const corsLocals = new Set(
    bindings
      .filter(
        (binding) =>
          binding.moduleSpecifier === "hono/cors" && binding.imported === "cors",
      )
      .map((binding) => binding.local),
  );
  const corsNamespaces = new Set(
    bindings
      .filter(
        (binding) =>
          binding.moduleSpecifier === "hono/cors" && binding.imported === "*",
      )
      .map((binding) => binding.local),
  );
  const importsHonoCors = bindings.some(
    (binding) => binding.moduleSpecifier === "hono/cors",
  );
  // `await import("hono/cors")` / `require("hono/cors")` / `import c =
  // require("hono/cors")` obtain the factory under a binding this assertion
  // cannot follow (round 6): found, never allowlisted.
  const dynamicReferences = collectDynamicModuleReferences(sourceFile);
  const dynamicCors = dynamicReferences.find(
    (reference) => reference.specifier === "hono/cors",
  );
  if (dynamicCors) {
    return failed(
      lineOf(sourceFile, dynamicCors.node),
      "`hono/cors` is loaded through `import()` / `require()` / `import x = require()` rather than an `import` declaration, so the CORS factory reaches a binding the checker cannot follow.",
    );
  }
  // In a router-declaring module (round 7), a dynamic reference with a
  // NON-LITERAL specifier may be `hono/cors` under a name the checker cannot
  // see (`const spec = "hono/" + "cors"; (await import(spec)).cors({ origin:
  // (o) => o })`), and a tsconfig `paths` alias (`~/node_modules/hono/cors`)
  // is a specifier the bundler does not resolve; both fail the assertion the
  // way they fail discovery.
  const declaresRouter =
    convexPath === "http.ts" ||
    sourceFile.statements.some(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            isHonoRouterDeclaration(declaration),
        ),
    );
  if (declaresRouter) {
    const opaque = dynamicReferences.find(
      (reference) =>
        reference.specifier === undefined ||
        isTsconfigAliasSpecifier(reference.specifier),
    );
    if (opaque) {
      return failed(
        lineOf(sourceFile, opaque.node),
        `the router module loads a module through \`${opaque.node.getText(sourceFile).slice(0, 60)}\`, whose specifier is ${opaque.specifier === undefined ? "not a string literal" : "a tsconfig `paths` alias the Convex bundler does not resolve"}; it may be \`hono/cors\` under a binding the checker cannot follow, so the CORS middleware is not statically an allowlist.`,
      );
    }
    const aliasImport = bindings.find((binding) =>
      isTsconfigAliasSpecifier(binding.moduleSpecifier),
    );
    if (aliasImport) {
      return failed(
        undefined,
        `the router module imports \`${aliasImport.moduleSpecifier}\` through a tsconfig \`paths\` alias the Convex bundler does not resolve; it may be \`hono/cors\` under a binding the checker cannot follow, so the CORS middleware is not statically an allowlist.`,
      );
    }
  }

  /** Does this expression denote the hono/cors middleware factory? */
  const isCorsFactory = (node: ts.Expression): boolean => {
    const value = unwrapTypeOnly(node);
    if (ts.isIdentifier(value)) return corsLocals.has(value.text);
    if (
      ts.isPropertyAccessExpression(value) &&
      ts.isIdentifier(value.expression) &&
      corsNamespaces.has(value.expression.text)
    ) {
      return value.name.text === "cors";
    }
    if (
      ts.isElementAccessExpression(value) &&
      ts.isIdentifier(value.expression) &&
      corsNamespaces.has(value.expression.text)
    ) {
      // A computed member off the namespace may be `cors`; fail closed.
      return true;
    }
    return false;
  };

  // Widen through local rebindings until the set stops growing.
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    const widen = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const initializer = unwrapTypeOnly(node.initializer);
        if (ts.isIdentifier(node.name) && isCorsFactory(initializer)) {
          if (!corsLocals.has(node.name.text)) {
            corsLocals.add(node.name.text);
            changed = true;
          }
        } else if (
          ts.isObjectBindingPattern(node.name) &&
          ts.isIdentifier(initializer) &&
          corsNamespaces.has(initializer.text)
        ) {
          for (const element of node.name.elements) {
            if (ts.isIdentifier(element.name) && !corsLocals.has(element.name.text)) {
              corsLocals.add(element.name.text);
              changed = true;
            }
          }
        }
      }
      ts.forEachChild(node, widen);
    };
    widen(sourceFile);
    if (!changed) break;
  }
  const allowlistLocals = new Set(
    bindings
      .filter(
        (binding) =>
          binding.imported !== "*" &&
          resolveModuleSpecifier(convexPath, binding.moduleSpecifier) ===
            STOREFRONT_ORIGINS_CONVEX_PATH,
      )
      .map((binding) => binding.local),
  );

  const routerVariables = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && isHonoRouterDeclaration(declaration)) {
        routerVariables.add(declaration.name.text);
      }
    }
  }

  /** identifier from storefrontOrigins, or a zero-arg call to one. */
  const isAllowlistSource = (node: ts.Expression) => {
    if (ts.isIdentifier(node)) return allowlistLocals.has(node.text);
    return (
      ts.isCallExpression(node) &&
      !node.questionDotToken &&
      node.arguments.length === 0 &&
      ts.isIdentifier(node.expression) &&
      allowlistLocals.has(node.expression.text)
    );
  };
  const originIsAllowlist = (value: ts.Expression) => {
    if (isAllowlistSource(value)) return true;
    if (!ts.isArrayLiteralExpression(value)) return false;
    return value.elements.every((element) => {
      if (stringLiteralText(element) !== undefined) {
        return stringLiteralText(element) !== "*";
      }
      return ts.isSpreadElement(element) && isAllowlistSource(element.expression);
    });
  };

  const corsCalls: {
    node: ts.CallExpression;
    underRouterUse: boolean;
    fromHonoCors: boolean;
  }[] = [];
  /** Uses of a hono/cors binding that are not the callee of a call. */
  const strayUses: ts.Node[] = [];
  const isCorsBindingReference = (node: ts.Node) =>
    ts.isIdentifier(node) &&
    isValueReference(node) &&
    (corsLocals.has(node.text) || corsNamespaces.has(node.text));
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapTypeOnly(node.expression);
      const fromHonoCors = isCorsFactory(callee);
      const bareCors = ts.isIdentifier(callee) && callee.text === "cors";
      if (fromHonoCors || bareCors) {
        const parent = node.parent;
        const underRouterUse =
          ts.isCallExpression(parent) &&
          parent.arguments.includes(node) &&
          ts.isPropertyAccessExpression(parent.expression) &&
          parent.expression.name.text === "use" &&
          ts.isIdentifier(parent.expression.expression) &&
          routerVariables.has(parent.expression.expression.text);
        corsCalls.push({ node, underRouterUse, fromHonoCors });
        // The callee itself is accounted for; only its arguments are walked.
        for (const argument of node.arguments) visit(argument);
        return;
      }
    }
    if (isCorsBindingReference(node)) {
      const parent = node.parent;
      const namespaceMemberRead =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        corsNamespaces.has((node as ts.Identifier).text) &&
        ((ts.isCallExpression(parent.parent) &&
          unwrapTypeOnly(parent.parent.expression) === parent) ||
          (ts.isVariableDeclaration(parent.parent) &&
            parent.parent.initializer === parent));
      const rebinding =
        ts.isVariableDeclaration(parent) && parent.initializer === node;
      const namespaceDestructure =
        ts.isVariableDeclaration(parent) &&
        parent.initializer === node &&
        ts.isObjectBindingPattern(parent.name);
      if (!namespaceMemberRead && !rebinding && !namespaceDestructure) {
        strayUses.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (corsCalls.length === 0) {
    if (importsHonoCors) {
      return failed(
        strayUses[0] ? lineOf(sourceFile, strayUses[0]) : undefined,
        "`hono/cors` is imported but never called as `<router>.use(cors({...}))`; a binding handed elsewhere is a middleware the checker cannot see.",
      );
    }
    return {
      found: false,
      allowlisted: false,
      detail: "No CORS middleware registration found in the router.",
    };
  }
  if (corsCalls.length > 1) {
    return failed(
      lineOf(sourceFile, corsCalls[1].node),
      `cors() is called ${corsCalls.length} times (counting every spelling that resolves to hono/cors — named, namespaced, or rebound); the router registers exactly one CORS middleware, so a second call is either a duplicate or a decoy that masks the first.`,
    );
  }
  if (strayUses.length > 0) {
    return failed(
      lineOf(sourceFile, strayUses[0]),
      "a `hono/cors` binding is used other than as the direct callee of the one accepted `cors({...})` call, so a second middleware may be registered through a spelling the checker cannot follow.",
    );
  }

  const [{ node, underRouterUse, fromHonoCors }] = corsCalls;
  const line = lineOf(sourceFile, node);
  if (!fromHonoCors) {
    return failed(line, "`cors` is not imported from `hono/cors`, so the call is not the Hono CORS middleware.");
  }
  if (!underRouterUse) {
    return failed(line, "cors() is not passed directly to `<router>.use(...)` on a Hono router declared in this module, so it is not the middleware the router runs.");
  }
  const [config] = node.arguments;
  if (!config || !ts.isObjectLiteralExpression(config)) {
    return failed(line, "cors() was called without an inspectable config object.");
  }
  const originProperty = config.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "origin",
  ) as ts.PropertyAssignment | undefined;
  if (!originProperty) {
    return failed(line, "cors() config declares no `origin`, so Hono reflects `*`.");
  }

  const value = originProperty.initializer;
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return failed(line, "cors() `origin` is a callback; a reflect-any-origin callback with credentials is not an allowlist.");
  }
  if (stringLiteralText(value) === "*") {
    return failed(line, 'cors() `origin` is the wildcard "*".');
  }
  if (!originIsAllowlist(value)) {
    return failed(
      line,
      `cors() \`origin\` is ${describeExpressionForOperator(value)} that is not statically an allowlist; only an array literal of string literals / spreads of \`platform/storefrontOrigins.ts\` exports, or such an export (or a zero-argument call to one) directly, is accepted.`,
    );
  }
  return {
    found: true,
    allowlisted: true,
    line,
    detail: "cors() `origin` is statically a fixed allowlist.",
  };
}

// ---------------------------------------------------------------------------
// Definition loading + matching
// ---------------------------------------------------------------------------

/**
 * The only modules a wrapper's definition may be imported from: the two
 * registry modules and the per-unit domain modules they compose. A definition
 * object living anywhere else is not "the registry" even if it names the
 * ingress.
 */
function isDefinitionModulePath(convexPath: string) {
  return (
    convexPath === "operationAdmission/definitions.ts" ||
    convexPath === "operationAdmission/readDefinitions.ts" ||
    convexPath.startsWith("operationAdmission/domains/")
  );
}

/**
 * Is the object handed to the wrapper the registered definition? IDENTITY,
 * and only identity (round 6): the registry arrays and the domain modules are
 * one ESM graph, and the checker loads the registry and the ingress's
 * definition module through the same `import()` of the same file URL, so the
 * const the ingress imports IS the array element. There is no structural
 * fallback: definitions carry function-valued policy (`scope.resolve`, target
 * guards, `ingressVerification.verify`, adapters) that no serialization can
 * compare, so a field-for-field "equal" shadow with a lax resolver would pass
 * a JSON comparison while the rail admits under a policy the registry never
 * declared. A definition object that is not the registered instance is a
 * shadow, whatever its fields say.
 */
function sameDefinition(
  registered: OperationAdmissionDefinition,
  handed: OperationAdmissionDefinition,
) {
  return registered === handed;
}

function definitionTargetId(definition: OperationAdmissionDefinition) {
  if (definition.route?.method && definition.route.path) {
    return `${definition.route.method.toUpperCase()} ${definition.route.path}`;
  }
  return definition.functionName ?? definition.operationId;
}

function definitionKind(
  definition: OperationAdmissionDefinition,
): IngressKind | undefined {
  const kind = definition.kind;
  if (
    kind === "mutation" ||
    kind === "query" ||
    kind === "action" ||
    kind === "http" ||
    kind === "http_read"
  ) {
    return kind;
  }
  return undefined;
}

async function importIfPresent(filePath: string) {
  try {
    return (await import(pathToFileURL(filePath).href)) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

async function loadDefinitions(repoRoot: string) {
  const base = path.join(repoRoot, CONVEX_ROOT_RELATIVE, "operationAdmission");
  const writes = await importIfPresent(path.join(base, "definitions.ts"));
  const reads = await importIfPresent(path.join(base, "readDefinitions.ts"));
  return {
    operationDefinitions:
      (writes?.OPERATION_ADMISSION_DEFINITIONS as
        | OperationAdmissionDefinition[]
        | undefined) ?? [],
    readDefinitions:
      (reads?.OPERATION_READ_ADMISSION_DEFINITIONS as
        | OperationAdmissionDefinition[]
        | undefined) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Filesystem walk
// ---------------------------------------------------------------------------

/**
 * Walk the convex tree the way the bundler does: every directory except the
 * TOP-LEVEL `_generated/` (a nested `foo/_generated/` is bundled and so is
 * walked), every file the bundler treats as an entry point.
 */
async function listConvexSourceFiles(
  directory: string,
  convexRoot = directory,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "_generated" && directory === convexRoot
          ? []
          : listConvexSourceFiles(entryPath, convexRoot);
      }
      return entry.isFile() &&
        !isExcludedConvexSourcePath(
          normalizeRepoPath(path.relative(convexRoot, entryPath)),
        )
        ? [entryPath]
        : [];
    }),
  );
  return files.flat().sort((left, right) => left.localeCompare(right));
}

export async function loadConvexModules(
  repoRoot: string,
): Promise<ConvexModule[]> {
  const convexRoot = path.join(repoRoot, CONVEX_ROOT_RELATIVE);
  const files = await listConvexSourceFiles(convexRoot);
  return Promise.all(
    files.map(async (absolutePath) => {
      const filePath = normalizeRepoPath(path.relative(repoRoot, absolutePath));
      const source = await readFile(absolutePath, "utf8");
      return {
        filePath,
        convexPath: toConvexRelativePath(filePath),
        moduleName: toConvexModuleName(filePath),
        source,
        sourceFile: parseSource(filePath, source),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Partition
// ---------------------------------------------------------------------------

export function ownerOfConvexPath(convexPath: string) {
  for (const row of UNIT_OWNERSHIP) {
    if (row.files?.includes(convexPath)) return row.unit;
    if (row.prefixes?.some((prefix) => convexPath.startsWith(prefix))) {
      return row.unit;
    }
  }
  return undefined;
}

function buildPartition(ingress: readonly IngressRegistration[]) {
  const byUnit = new Map<string, IngressRegistration[]>();
  const orphanFiles = new Set<string>();

  for (const entry of ingress) {
    const convexPath = toConvexRelativePath(entry.filePath);
    const unit = ownerOfConvexPath(convexPath);
    if (!unit) {
      orphanFiles.add(convexPath);
      continue;
    }
    const list = byUnit.get(unit) ?? [];
    list.push(entry);
    byUnit.set(unit, list);
  }

  const isRoute = (entry: IngressRegistration) =>
    entry.kind === "http" || entry.kind === "http_read";

  const partition: PartitionUnitReport[] = UNIT_OWNERSHIP.map((row) => {
    const entries = byUnit.get(row.unit) ?? [];
    const files = new Set(entries.map((entry) => entry.filePath));
    const raw = entries.filter((entry) => !entry.admitted);
    return {
      unit: row.unit,
      files: files.size,
      mutations: entries.filter((entry) => entry.kind === "mutation").length,
      queries: entries.filter((entry) => entry.kind === "query").length,
      actions: entries.filter((entry) => entry.kind === "action").length,
      routes: entries.filter(isRoute).length,
      rawMutations: raw.filter((entry) => entry.kind === "mutation").length,
      rawQueries: raw.filter((entry) => entry.kind === "query").length,
      rawActions: raw.filter((entry) => entry.kind === "action").length,
      rawRoutes: raw.filter(isRoute).length,
      admitted: entries.filter((entry) => entry.admitted).length,
      raw: raw.filter((entry) => entry.kind !== "registrar").length,
    };
  });

  return { partition, orphanFiles: [...orphanFiles].sort() };
}

export function formatPartitionReport(result: OperationAdmissionCheckResult) {
  const header =
    "| Unit | files | m (raw/all) | q (raw/all) | a (raw/all) | routes (raw/all) | admitted |";
  const divider = "|---|---:|---:|---:|---:|---:|---:|";
  const cell = (raw: number, all: number) => `${raw}/${all}`;
  const rows = result.partition.map(
    (row) =>
      `| ${row.unit} | ${row.files} | ${cell(row.rawMutations, row.mutations)} | ${cell(row.rawQueries, row.queries)} | ${cell(row.rawActions, row.actions)} | ${cell(row.rawRoutes, row.routes)} | ${row.admitted} |`,
  );
  const totals = result.partition.reduce(
    (accumulator, row) => ({
      files: accumulator.files + row.files,
      mutations: accumulator.mutations + row.mutations,
      queries: accumulator.queries + row.queries,
      actions: accumulator.actions + row.actions,
      routes: accumulator.routes + row.routes,
      rawMutations: accumulator.rawMutations + row.rawMutations,
      rawQueries: accumulator.rawQueries + row.rawQueries,
      rawActions: accumulator.rawActions + row.rawActions,
      rawRoutes: accumulator.rawRoutes + row.rawRoutes,
      admitted: accumulator.admitted + row.admitted,
      raw: accumulator.raw + row.raw,
    }),
    {
      files: 0,
      mutations: 0,
      queries: 0,
      actions: 0,
      routes: 0,
      rawMutations: 0,
      rawQueries: 0,
      rawActions: 0,
      rawRoutes: 0,
      admitted: 0,
      raw: 0,
    },
  );
  const totalRow = `| TOTAL | ${totals.files} | ${cell(totals.rawMutations, totals.mutations)} | ${cell(totals.rawQueries, totals.queries)} | ${cell(totals.rawActions, totals.actions)} | ${cell(totals.rawRoutes, totals.routes)} | ${totals.admitted} |`;
  const orphans =
    result.orphanFiles.length === 0
      ? "Orphan files: none"
      : `Orphan files (${result.orphanFiles.length}):\n${result.orphanFiles
          .map((file) => `  - ${file}`)
          .join("\n")}`;
  return [header, divider, ...rows, totalRow, "", orphans].join("\n");
}

// ---------------------------------------------------------------------------
// Caller table + downstream writes
// ---------------------------------------------------------------------------

type BackendCall = {
  filePath: string;
  callee: string;
  calleeRoot: "api" | "internal";
  via: string;
  line: number;
  idArgs: { name: string; source: "client-supplied" | "admitted-actor" }[];
};

function collectBackendCalls(
  sourceFile: ts.SourceFile,
  body: ts.Node,
  filePath = normalizeRepoPath(sourceFile.fileName),
): BackendCall[] {
  const calls: BackendCall[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      RUN_METHODS.has(node.expression.name.text)
    ) {
      const reference = node.arguments[0];
      const referenceText = reference?.getText(sourceFile) ?? "";
      const root = referenceText.startsWith("api.")
        ? "api"
        : referenceText.startsWith("internal.")
          ? "internal"
          : undefined;
      if (root) {
        const idArgs: BackendCall["idArgs"] = [];
        const payload = node.arguments[1];
        if (payload && ts.isObjectLiteralExpression(payload)) {
          for (const property of payload.properties) {
            const name = ts.isPropertyAssignment(property)
              ? property.name.getText(sourceFile)
              : ts.isShorthandPropertyAssignment(property)
                ? property.name.text
                : undefined;
            if (!name || !/(^id$|Id$|Ids$)/i.test(name)) continue;
            const valueText = ts.isPropertyAssignment(property)
              ? property.initializer.getText(sourceFile)
              : name;
            idArgs.push({
              name,
              source: valueText.includes("operationAdmission")
                ? "admitted-actor"
                : "client-supplied",
            });
          }
        }
        calls.push({
          filePath,
          callee: referenceText,
          calleeRoot: root,
          via: node.expression.name.text,
          line: lineOf(sourceFile, node),
          idArgs,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return calls;
}

/**
 * Find a plain helper function (not a Convex registration) by name in a module.
 */
function findHelperFunction(module: ConvexModule, name: string) {
  for (const statement of module.sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement.body;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== name ||
        !declaration.initializer
      ) {
        continue;
      }
      if (
        ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer)
      ) {
        return declaration.initializer.body;
      }
    }
  }
  return undefined;
}

/**
 * Collect backend calls reachable from an ingress body, following plain helper
 * functions across modules. A route that reaches an internal mutation through
 * a helper still reaches it, so the caller table and the downstream-write list
 * would be wrong if the walk stopped at the handler body.
 */
function collectReachableBackendCalls(
  module: ConvexModule,
  body: ts.Node,
  moduleByConvexPath: ReadonlyMap<string, ConvexModule>,
  knownConvexPaths: ReadonlySet<string>,
  visited = new Set<string>(),
  depth = 0,
): BackendCall[] {
  const calls = collectBackendCalls(module.sourceFile, body);
  if (depth >= 3) return calls;

  const importBindings = collectImportBindings(module.sourceFile);
  const helperNames = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      helperNames.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);

  for (const name of helperNames) {
    const binding = importBindings.find((candidate) => candidate.local === name);
    let targetModule = module;
    let targetName = name;
    if (binding) {
      const targetPath = resolveModuleSpecifier(
        module.convexPath,
        binding.moduleSpecifier,
        knownConvexPaths,
      );
      const resolved = targetPath ? moduleByConvexPath.get(targetPath) : undefined;
      if (!resolved) continue;
      targetModule = resolved;
      targetName = binding.imported;
    }
    const key = `${targetModule.convexPath}#${targetName}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const helperBody = findHelperFunction(targetModule, targetName);
    if (!helperBody) continue;
    calls.push(
      ...collectReachableBackendCalls(
        targetModule,
        helperBody,
        moduleByConvexPath,
        knownConvexPaths,
        visited,
        depth + 1,
      ),
    );
  }

  return calls;
}

async function loadClientSourceText(repoRoot: string) {
  const roots = [
    path.join(repoRoot, "packages/athena-webapp/src"),
    path.join(repoRoot, "packages/storefront-webapp/src"),
  ];
  const chunks: string[] = [];
  const walk = async (directory: string) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        chunks.push(await readFile(entryPath, "utf8"));
      }
    }
  };
  await Promise.all(roots.map(walk));
  return chunks.join("\n");
}

export function formatCallerTable(rows: readonly CallerTableRow[]) {
  const lines = [
    "<!-- Generated by scripts/convex-operation-admission-check.ts --callers. Do not edit by hand. -->",
    "",
    "# Backend caller table (2026-08-16-002)",
    "",
    "Every HTTP route and public action, the backend functions its body calls, the",
    "id arguments it forwards, and where each id comes from. `client-supplied` ids",
    "on a customer-reachable path need an ownership assertion in the callee against",
    "the admitted actor; the admitted identity travels as a dedicated `owner`",
    "parameter, never as a request-body field.",
    "",
    "| Ingress | Kind | Site | Callee | Root | Id args (source) | Disposition |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    const ids =
      row.idArgs.length === 0
        ? "—"
        : row.idArgs
            .map((argument) => `\`${argument.name}\` (${argument.source})`)
            .join("<br>");
    lines.push(
      `| \`${row.ingressId}\` | ${row.ingressKind} | ${row.filePath}:${row.line} | \`${row.callee}\` | ${row.calleeRoot} | ${ids} | ${row.disposition} |`,
    );
  }
  lines.push("");
  lines.push(`Rows: ${rows.length}`);
  lines.push("");
  return lines.join("\n");
}

export function formatDownstreamWrites(rows: readonly DownstreamWriteRow[]) {
  const lines = [
    "<!-- Generated by scripts/convex-operation-admission-check.ts --downstream-writes. Do not edit by hand. -->",
    "",
    "# Downstream internal writes from demo-admitted actions and routes (2026-08-16-002)",
    "",
    "Action and HTTP admission is an ingress-time fence only. Every internal",
    "mutation listed here is reached from a shared-demo-admitted action or route,",
    "so it must re-apply the readiness fence and the foundation guard with the",
    "admitted store id rather than trusting the ingress decision.",
    "",
    "| Ingress | Kind | Operation | Internal mutation | Depth |",
    "|---|---|---|---|---:|",
  ];
  for (const row of rows) {
    lines.push(
      `| \`${row.ingressId}\` | ${row.ingressKind} | \`${row.operationId}\` | \`${row.internalMutation}\` | ${row.depth} |`,
    );
  }
  lines.push("");
  lines.push(`Rows: ${rows.length}`);
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main collection
// ---------------------------------------------------------------------------

export async function collectOperationAdmissionCheckResult(
  repoRoot: string,
  options: CheckOptions = {},
): Promise<OperationAdmissionCheckResult> {
  const modules = await loadConvexModules(repoRoot);
  const moduleByConvexPath = new Map(
    modules.map((module) => [module.convexPath, module]),
  );

  const loaded =
    options.operationDefinitions || options.readDefinitions
      ? {
          operationDefinitions: options.operationDefinitions ?? [],
          readDefinitions: options.readDefinitions ?? [],
        }
      : await loadDefinitions(repoRoot);
  const definitions = [
    ...loaded.operationDefinitions,
    ...loaded.readDefinitions,
  ];

  // --- discovery -----------------------------------------------------------
  const knownConvexPaths = new Set(modules.map((entry) => entry.convexPath));
  const convexIngress = modules.flatMap((module) =>
    collectConvexIngressFromSource(module.filePath, module.source, {
      knownConvexPaths,
      repoRoot,
    }),
  );

  const routeFacts = new Map<string, RouteModuleFacts>();
  for (const module of modules) {
    routeFacts.set(
      module.convexPath,
      collectRouteModuleFacts(
        module,
        collectWrapperNames(module.sourceFile, module.convexPath),
        knownConvexPaths,
      ),
    );
  }
  // Round 7: the router reference sweep needs every module's exported routers
  // resolved first, so it runs once all facts are in.
  const routerExportIndex = buildRouterExportIndex(routeFacts);
  for (const module of modules) {
    const facts = routeFacts.get(module.convexPath);
    if (facts) {
      sweepRouterReferences(module, facts, routerExportIndex, knownConvexPaths);
    }
  }
  const { routes, registrations: routeRegistrations } =
    resolveRouteRegistrations(routeFacts);

  const ingress = [...convexIngress, ...routes].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  const findings: OperationAdmissionFinding[] = [];
  const push = (finding: OperationAdmissionFinding) => findings.push(finding);

  // --- framework entry points ---------------------------------------------
  const frameworkIds = new Set(
    FRAMEWORK_ENTRY_POINTS.filter((entry) => entry.kind === "registrar").map(
      (entry) => entry.id,
    ),
  );
  const discoveredRegistrars = new Set(
    ingress
      .filter((entry) => entry.kind === "registrar")
      .map((entry) => entry.id),
  );

  for (const entry of FRAMEWORK_ENTRY_POINTS) {
    if (entry.kind !== "registrar") continue;
    if (discoveredRegistrars.has(entry.id)) continue;
    push({
      id: `framework-entry-point-not-discovered-${slugifyForFindingId(entry.id)}`,
      severity: "high",
      title: "Framework entry point is named but no longer discovered",
      filePath: entry.filePath,
      functionName: entry.id,
      rationale: `FRAMEWORK_ENTRY_POINTS names ${entry.id}, but discovery found no matching registrar export. The list is verified both ways so a stale entry cannot silently widen the non-admitted surface.`,
      remediation: `Remove ${entry.id} from FRAMEWORK_ENTRY_POINTS, or restore the registrar export.`,
    });
  }
  for (const registrarId of [...discoveredRegistrars].sort()) {
    if (frameworkIds.has(registrarId)) continue;
    const entry = ingress.find((candidate) => candidate.id === registrarId);
    push({
      id: `unlisted-framework-registrar-export-${slugifyForFindingId(registrarId)}`,
      severity: "high",
      title: "Framework registrar export is not named in FRAMEWORK_ENTRY_POINTS",
      filePath: entry?.filePath ?? `${CONVEX_ROOT_RELATIVE}/auth.ts`,
      line: entry?.line,
      functionName: registrarId,
      rationale:
        "A new registrar export appeared. Non-admitted ingress is allowed only when it is named with a reason, so an unnamed one is unaccounted-for backend surface.",
      remediation: `Name ${registrarId} in FRAMEWORK_ENTRY_POINTS with the reason it cannot be admitted, or route it through the rail.`,
    });
  }

  // auth.addHttpRoutes: exactly once, from http.ts.
  const addHttpRoutesSites: { convexPath: string; line: number }[] = [];
  for (const [convexPath, facts] of routeFacts) {
    for (const call of facts.addHttpRoutesCalls) {
      addHttpRoutesSites.push({ convexPath, line: call.line });
    }
  }
  const httpFamilyEntry = FRAMEWORK_ENTRY_POINTS.find(
    (entry) => entry.kind === "http_family",
  );
  if (httpFamilyEntry) {
    const fromRouter = addHttpRoutesSites.filter(
      (site) => site.convexPath === "http.ts",
    );
    if (addHttpRoutesSites.length !== 1 || fromRouter.length !== 1) {
      push({
        id: "auth-http-route-family-not-registered-once",
        severity: "high",
        title:
          "auth.addHttpRoutes is not registered exactly once from http.ts",
        filePath: httpFamilyEntry.filePath,
        functionName: "auth.addHttpRoutes",
        rationale: `The Convex Auth HTTP family is the only non-admitted route family; it is trusted because it is installed exactly once, from the router module. Found ${addHttpRoutesSites.length} registration(s), ${fromRouter.length} of them in http.ts.`,
        remediation:
          "Register auth.addHttpRoutes exactly once, in convex/http.ts, and nowhere else.",
      });
    }
  }

  // --- definition <-> ingress reconciliation -------------------------------
  const definitionByTarget = new Map<
    string,
    OperationAdmissionDefinition[]
  >();
  for (const definition of definitions) {
    const target = definitionTargetId(definition);
    if (!target) {
      push({
        id: "operation-definition-missing-target",
        severity: "high",
        title: "Operation definition names neither a function nor a route",
        filePath: `${CONVEX_ROOT_RELATIVE}/operationAdmission/definitions.ts`,
        rationale:
          "The checker matches definitions to ingress by functionName or route, so a definition with neither can never be proven installed.",
        remediation:
          "Give the definition a `functionName` (`module:export`) or a `route` ({ method, path }).",
      });
      continue;
    }
    const list = definitionByTarget.get(target) ?? [];
    list.push(definition);
    definitionByTarget.set(target, list);
  }

  for (const [target, list] of [...definitionByTarget].sort()) {
    if (list.length > 1) {
      push({
        id: `duplicate-operation-definition-${slugifyForFindingId(target)}`,
        severity: "high",
        title: "Duplicate operation admission definition",
        filePath: `${CONVEX_ROOT_RELATIVE}/operationAdmission/definitions.ts`,
        functionName: target,
        rationale:
          "One ingress may have only one definition; duplicates make the declared capability, scope, and actor coverage ambiguous.",
        remediation: `Collapse the duplicate definitions for ${target} into one.`,
      });
    }
    for (const definition of list) {
      const kind = definitionKind(definition);
      if (!kind) {
        push({
          id: `operation-definition-missing-kind-${slugifyForFindingId(target)}`,
          severity: "high",
          title: "Operation definition does not declare an ingress kind",
          filePath: `${CONVEX_ROOT_RELATIVE}/operationAdmission/definitions.ts`,
          functionName: target,
          rationale:
            "Kind classification is what lets an action- or route-targeting definition match its ingress instead of looking stale.",
          remediation:
            'Declare `kind: "mutation" | "query" | "action" | "http" | "http_read"` on the definition.',
        });
      }
      const isRead = kind === "query" || kind === "http_read";
      if (!isRead && definition.capability === undefined) {
        push({
          id: `operation-definition-missing-capability-${slugifyForFindingId(target)}`,
          severity: "high",
          title: "Operation definition is missing a capability",
          filePath: `${CONVEX_ROOT_RELATIVE}/operationAdmission/definitions.ts`,
          functionName: target,
          rationale:
            "Write admission must declare the capability it protects before the handler runs.",
          remediation: "Add a catalog capability to the operation definition.",
        });
      }
      if (isRead && !definition.access?.intent) {
        push({
          id: `read-definition-missing-intent-${slugifyForFindingId(target)}`,
          severity: "high",
          title: "Read definition is missing a read intent",
          filePath: `${CONVEX_ROOT_RELATIVE}/operationAdmission/readDefinitions.ts`,
          functionName: target,
          rationale:
            "Shared-demo read reach is decided by intent, so a read definition without one cannot be evaluated.",
          remediation:
            "Add an `access.intent` from the read intent catalog to the read definition.",
        });
      }
    }
  }

  const ingressById = new Map(ingress.map((entry) => [entry.id, entry]));

  // --- route registrations the checker could not resolve ------------------
  for (const convexPath of [...routeFacts.keys()].sort()) {
    const sites = [...(routeFacts.get(convexPath)?.unresolvable ?? [])].sort(
      (left, right) => left.line - right.line,
    );
    for (const site of sites) {
      push({
        id: `route-registration-not-statically-resolvable-${slugifyForFindingId(`${site.filePath}-${site.line}`)}`,
        severity: "high",
        title: "Route registration is not statically resolvable",
        filePath: site.filePath,
        line: site.line,
        functionName: site.label ?? `.${site.method}(...)`,
        rationale: `${site.reason}. A registration the checker cannot follow is not "no route", it is a route with unknown admission, so it fails closed.`,
        remediation:
          "Register the route on a top-level router binding with a string-literal path (or `.on` with literal methods and path) and the admitted handler as the last argument; mount child routers only with `.route(<literal prefix>, <router identifier>)`; do not use `.mount`; and reference a router ONLY as the receiver of a registration, the child of `.route`, the argument of `new HttpRouterWithHono` / `addHttpRoutes`, or an export.",
      });
    }
  }

  // --- definition identity: the wrapper must be handed THIS ingress's
  //     definition ------------------------------------------------------------
  const definitionModuleCache = new Map<
    string,
    Promise<Record<string, unknown> | undefined>
  >();
  const loadDefinitionModule = (convexPath: string) => {
    let pending = definitionModuleCache.get(convexPath);
    if (!pending) {
      pending = importIfPresent(
        path.join(repoRoot, CONVEX_ROOT_RELATIVE, convexPath),
      );
      definitionModuleCache.set(convexPath, pending);
    }
    return pending;
  };
  const definitionIdentityFindings = new Map<string, OperationAdmissionFinding>();
  for (const entry of ingress) {
    if (!entry.admitted || !entry.definitionReference) continue;
    const module = moduleByConvexPath.get(toConvexRelativePath(entry.filePath));
    const reference = entry.definitionReference;
    const spelled = [reference.root, ...reference.path].join(".");
    const unresolvable = (why: string) => {
      definitionIdentityFindings.set(entry.id, {
        id: `admission-definition-not-statically-resolvable-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Admission definition cannot be resolved to a declared definition",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale: `The wrapper on ${entry.id} is handed \`${spelled}\`, but ${why}. The wrapper admits with whatever definition it receives, so a definition the checker cannot resolve is a policy it cannot verify.`,
        remediation:
          "Import the definition const by name from convex/operationAdmission/definitions.ts, readDefinitions.ts, or a domains/ module, and pass that identifier (or a dotted member of a namespace import of one of those modules) to the wrapper.",
      });
    };
    if (!module) {
      unresolvable("the ingress module could not be loaded");
      continue;
    }
    const binding = collectImportBindings(module.sourceFile).find(
      (candidate) => candidate.local === reference.root,
    );
    if (!binding) {
      unresolvable(
        `\`${reference.root}\` is not an import binding of this module; a definition declared inline cannot be checked against the registry`,
      );
      continue;
    }
    const targetPath = resolveModuleSpecifier(
      module.convexPath,
      binding.moduleSpecifier,
      knownConvexPaths,
    );
    if (!targetPath || !knownConvexPaths.has(targetPath)) {
      unresolvable(
        `its import specifier \`${binding.moduleSpecifier}\` does not resolve to a convex module`,
      );
      continue;
    }
    if (!isDefinitionModulePath(targetPath)) {
      unresolvable(
        `it is imported from \`${targetPath}\`, which is not one of the definition modules (\`operationAdmission/definitions.ts\`, \`operationAdmission/readDefinitions.ts\`, \`operationAdmission/domains/**\`); a definition declared anywhere else is a shadow of the registry, not the registry`,
      );
      continue;
    }
    const loaded = await loadDefinitionModule(targetPath);
    if (!loaded) {
      unresolvable(`the module \`${targetPath}\` could not be imported`);
      continue;
    }
    let value: unknown =
      binding.imported === "*"
        ? loaded
        : (loaded as Record<string, unknown>)[binding.imported];
    for (const segment of reference.path) {
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[segment]
          : undefined;
    }
    if (!value || typeof value !== "object") {
      unresolvable(
        `\`${spelled}\` does not evaluate to a definition object exported by \`${targetPath}\``,
      );
      continue;
    }
    const definition = value as OperationAdmissionDefinition;
    const target = definitionTargetId(definition);
    if (!target) {
      unresolvable(
        `the definition it resolves to in \`${targetPath}\` declares neither a functionName nor a route`,
      );
      continue;
    }
    if (target !== entry.id) {
      definitionIdentityFindings.set(entry.id, {
        id: `admission-definition-does-not-name-this-ingress-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Admission wrapper is handed a definition for a different ingress",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale: `The wrapper on ${entry.id} is handed \`${spelled}\`, which names \`${target}\`. The wrapper admits with whatever definition it receives, so this ingress runs under another operation's capability, scope, and actor policy while every reconciliation check stays green.`,
        remediation: `Pass the definition whose ${entry.route ? "route" : "functionName"} is ${entry.id} to the wrapper on this ingress.`,
      });
      continue;
    }
    // Naming this ingress is necessary, not sufficient: the object handed to
    // the wrapper must BE the registered definition for this id (the same ESM
    // instance the registry array holds — never a structural comparison, see
    // `sameDefinition`). A shadow with the right functionName and a
    // permissive policy would otherwise pass every reconciliation check while
    // the rail admits with the shadow.
    const registered = definitionByTarget.get(entry.id) ?? [];
    if (!registered.some((candidate) => sameDefinition(candidate, definition))) {
      definitionIdentityFindings.set(entry.id, {
        id: `admission-definition-not-registered-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Admission wrapper is handed a definition that is not the registered one",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale: `The wrapper on ${entry.id} is handed \`${spelled}\` from \`${targetPath}\`, which names this ingress but is not the definition the registry holds for it (${registered.length === 0 ? "the registry holds none" : "it is not the same object instance as the registered definition; a field-for-field copy is still a shadow, because function-valued policy (scope resolvers, guards, verifiers) cannot be compared structurally"}). The wrapper admits with whatever definition it receives, so a same-named shadow runs this ingress under a policy the registry never declared while every reconciliation check stays green.`,
        remediation: `Pass the definition const that convex/operationAdmission/definitions.ts or readDefinitions.ts composes into its registry array for ${entry.id}; delete the shadow.`,
      });
    }
  }

  for (const entry of ingress) {
    if (entry.kind === "registrar") continue;

    if (entry.notStaticallyResolvable) {
      push({
        id: `ingress-not-statically-resolvable-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Exported Convex function is not statically resolvable",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale: `${entry.notStaticallyResolvable}. Convex registers whatever the export evaluates to, so a spelling discovery cannot follow is public surface with unknown admission — a failure, not a pass.`,
        remediation:
          "Spell the export as `export const <name> = <builder>({ ..., handler: <admitted handler> })` (a top-level `const` re-exported with `export { name }`, or `export default <builder>({...})`, is also accepted).",
      });
      continue;
    }

    const matches = definitionByTarget.get(entry.id) ?? [];
    const kindMatched = matches.filter((definition) => {
      const kind = definitionKind(definition);
      return kind === undefined || kind === entry.kind;
    });

    const identityFinding = definitionIdentityFindings.get(entry.id);
    if (identityFinding) push(identityFinding);

    if (entry.wrapperOffComposition) {
      push({
        id: `admission-wrapper-not-from-composition-root-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Admission wrapper is not imported from the composition root",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale:
          "Only the composition root registers the adapters, resource guards, and capture port. A wrapper imported from the rail core runs a different, policy-free chain.",
        remediation: `Import ${entry.wrapper ?? "the wrapper"} from convex/platform/operationAdmission.`,
      });
    }

    if (entry.wrapperShape) {
      push({
        id: `wrapper-shape-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Admission wrapper is not spelled in an accepted shape",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        // Per-detector: the first sentence is why THIS handler was rejected,
        // and it is followed by the whole accepted grammar, so the fix needs no
        // reading of the checker. The grammar is a whitelist because three
        // consecutive review rounds each defeated a blacklist with a shape it
        // had not enumerated; "not obviously bad" is not a criterion here.
        rationale: `A canonical admission wrapper appears in this handler, but ${entry.wrapperShape}.\n  Admission is recognized only in these shapes, and nothing else is accepted:\n    ${ACCEPTED_WRAPPER_SHAPES}`,
        remediation:
          "Rewrite the handler as one of the accepted shapes. If it only needs to translate a typed admission denial into a CommandResult, use the third shape: a try whose block is exactly `return await <wrapper>(ctx, args);`, with the mapping in the catch (see convex/notifications/subscriptions.ts). Anything that must run before the wrapper cannot run before the wrapper.",
      });
    }

    if (!entry.admitted && kindMatched.length === 0) {
      push({
        id: `unadmitted-${entry.kind}-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: `Backend ingress (${entry.kind}) is not on the admission rail`,
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale:
          "Every backend ingress must declare an operation definition and route through the canonical wrapper for its kind. There is no exemption path: unadmitted ingress means actor, scope, readiness, capability, and effect policy never run.",
        remediation: `Add a ${entry.kind} definition for ${entry.id} in its unit's domains/ module and wrap the handler with the canonical wrapper.`,
      });
      continue;
    }

    if (!entry.admitted) {
      push({
        id: `definition-without-admission-wrapper-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Declared ingress does not route through its admission wrapper",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale:
          "A matching definition proves declaration, not installation. Without the wrapper the declared capability and scope are never enforced.",
        remediation: `Wrap this ${entry.kind} handler with the canonical wrapper for its kind.`,
      });
      continue;
    }

    if (kindMatched.length === 0) {
      push({
        id: `admitted-ingress-missing-definition-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Admitted ingress has no matching operation definition",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale:
          "The wrapper is installed but no definition of this ingress kind names it, so the checker cannot prove which capability or intent it declares.",
        remediation: `Add a ${entry.kind} definition whose ${entry.route ? "route" : "functionName"} matches ${entry.id}.`,
      });
      continue;
    }

    const wrapperKind = entry.wrapper
      ? CANONICAL_WRAPPERS[entry.wrapper]
      : undefined;
    if (wrapperKind && wrapperKind !== entry.kind) {
      push({
        id: `admission-wrapper-kind-mismatch-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Admission wrapper does not match the ingress kind",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale: `This ${entry.kind} ingress is wrapped by ${entry.wrapper}, which admits ${wrapperKind}. The wrong wrapper runs the wrong admission path (write transaction vs read query).`,
        remediation: `Use the canonical wrapper for ${entry.kind}.`,
      });
    }
  }

  for (const [target, list] of [...definitionByTarget].sort()) {
    const entry = ingressById.get(target);
    if (entry) {
      const kinds = new Set(
        list.map(definitionKind).filter(Boolean) as IngressKind[],
      );
      if (kinds.size > 0 && !kinds.has(entry.kind)) {
        push({
          id: `operation-definition-kind-mismatch-${slugifyForFindingId(target)}`,
          severity: "medium",
          title: "Operation definition kind does not match discovered ingress",
          filePath: entry.filePath,
          line: entry.line,
          functionName: target,
          rationale: `The definition declares ${[...kinds].join("/")} but ${target} is a ${entry.kind}.`,
          remediation: `Set the definition kind to "${entry.kind}".`,
        });
      }
      continue;
    }
    push({
      id: `stale-operation-definition-${slugifyForFindingId(target)}`,
      severity: "medium",
      title: "Operation definition does not match any discovered ingress",
      filePath: `${CONVEX_ROOT_RELATIVE}/operationAdmission`,
      functionName: target,
      rationale:
        "No exported public function or registered route matches this definition. Kind classification is applied first, so an action- or route-targeting definition is not reported here merely for being non-mutation.",
      remediation:
        "Delete the stale definition, or fix its functionName/route after a rename.",
    });
  }

  // --- api.* self-call ban -------------------------------------------------
  const publicFunctionNames = new Set(
    convexIngress
      .filter((entry) => entry.kind !== "registrar")
      .map((entry) => entry.id),
  );
  const apiSelfCallSitesByModule = new Map(
    modules.map((module) => [
      module.convexPath,
      collectApiSelfCallSites(module.filePath, module.source, {
        publicFunctionNames,
      }),
    ]),
  );
  for (const module of modules) {
    for (const site of apiSelfCallSitesByModule.get(module.convexPath) ?? []) {
      push({
        id: `api-self-call-${slugifyForFindingId(`${site.filePath}-${site.line}-${site.reference}`)}`,
        severity: "high",
        title: "Backend code calls a public function through api.*",
        filePath: site.filePath,
        line: site.line,
        functionName: site.reference,
        rationale:
          "An admitted body may call only internal.*. Re-entering through api.* runs a second admission with the backend's own context, which is how a route can launder a client-supplied id past the boundary.",
        remediation: `Call the internal sibling of ${site.reference} instead (see ${CALLER_TABLE_RELATIVE_PATH}); the ${site.via} reference must be internal.*.`,
      });
    }
  }

  // --- definition modules read no environment --------------------------------
  // The checker evaluates definition modules in ITS Node process and proves
  // identity against what it loaded; a definition whose field depends on the
  // environment (`actors: { public: process.env.X ? "admit" : "deny" }`) is
  // "registered" and "identical" here while the Convex runtime evaluates it
  // differently. So a definition module (`definitions.ts`, `readDefinitions.ts`,
  // `domains/**`) may not reference an environment reader at all (round 7).
  for (const module of modules) {
    if (!isDefinitionModulePath(module.convexPath)) continue;
    const envSites: { line: number; spelled: string }[] = [];
    const scan = (node: ts.Node) => {
      if (ts.isTypeNode(node)) return;
      if (
        ts.isIdentifier(node) &&
        isValueReference(node) &&
        ["process", "Deno", "globalThis", "self", "window"].includes(node.text) &&
        !isShadowedReference(node)
      ) {
        envSites.push({
          line: lineOf(module.sourceFile, node),
          spelled: node.parent.getText(module.sourceFile).slice(0, 60),
        });
      } else if (ts.isMetaProperty(node)) {
        envSites.push({
          line: lineOf(module.sourceFile, node),
          spelled: node.parent.getText(module.sourceFile).slice(0, 60),
        });
      }
      ts.forEachChild(node, scan);
    };
    scan(module.sourceFile);
    for (const site of envSites) {
      push({
        id: `definition-module-reads-environment-${slugifyForFindingId(`${module.convexPath}-${site.line}`)}`,
        severity: "high",
        title: "Definition module reads the environment",
        filePath: module.filePath,
        line: site.line,
        rationale: `${module.convexPath} references an environment reader (\`${site.spelled}\`). The checker evaluates definition modules in its own process and proves the wrapper receives the registered instance, so a definition whose fields depend on the environment is verified under one environment and enforced under another.`,
        remediation:
          "Keep definitions static: no `process.env` / `import.meta` / `globalThis` in definitions.ts, readDefinitions.ts, or domains/**. Environment-dependent policy belongs in the composition root or an adapter, where it is a runtime input, not a declared definition.",
      });
    }
  }

  // --- CORS allowlist ------------------------------------------------------
  // The assertion runs over EVERY module: http.ts must register exactly one
  // allowlisted cors(); any other module that so much as imports hono/cors
  // is a second CORS middleware Hono would run after (or before) the
  // allowlisted one, and the last one to write the header wins.
  const routerModule = moduleByConvexPath.get("http.ts");
  if (routerModule) {
    const cors = assertCorsAllowlist(
      routerModule.filePath,
      routerModule.source,
    );
    if (!cors.allowlisted) {
      push({
        id: "router-cors-origin-not-allowlisted",
        severity: "high",
        title: "Router CORS middleware does not use a fixed origin allowlist",
        filePath: routerModule.filePath,
        line: cors.line,
        rationale: `${cors.detail} The storefront claim cookie is SameSite=None, so reflecting the request origin with credentials makes every customer write route reachable cross-origin.`,
        remediation:
          "Source the CORS origin from convex/platform/storefrontOrigins.ts (exact-string allowlist, Vary: Origin, fail closed when unset).",
      });
    }
  }
  for (const module of modules) {
    if (module.convexPath === "http.ts") continue;
    const cors = assertCorsAllowlist(module.filePath, module.source);
    if (!cors.found) continue;
    push({
      id: `cors-middleware-outside-router-module-${slugifyForFindingId(module.convexPath)}`,
      severity: "high",
      title: "CORS middleware is registered outside convex/http.ts",
      filePath: module.filePath,
      line: cors.line,
      rationale: `${module.convexPath} imports or calls hono/cors. Only http.ts may register the CORS middleware, exactly once, with a fixed allowlist; a cors() on a sub-router or helper is a second middleware Hono runs for the routes it covers, and a reflect-any-origin one there overrides the allowlisted header for every request it sees.`,
      remediation:
        "Remove the hono/cors import from this module; the router-level cors() in convex/http.ts covers every mounted route.",
    });
  }

  // --- partition -----------------------------------------------------------
  const { partition, orphanFiles } = buildPartition(ingress);

  // --- caller table --------------------------------------------------------
  const clientSourceText = await loadClientSourceText(repoRoot);
  const callerTable: CallerTableRow[] = [];
  const callerSources: {
    entry: IngressRegistration;
    body: ts.Node;
    module: ConvexModule;
  }[] = [];

  for (const entry of ingress) {
    if (entry.kind === "action") {
      const module = moduleByConvexPath.get(
        toConvexRelativePath(entry.filePath),
      );
      if (!module) continue;
      const body = findExportedHandlerBody(module.sourceFile, entry.exportName);
      if (body) callerSources.push({ entry, body, module });
      continue;
    }
    if (entry.kind !== "http" && entry.kind !== "http_read") continue;
    const registration = routeRegistrations.get(entry.id);
    const module = moduleByConvexPath.get(toConvexRelativePath(entry.filePath));
    if (!registration?.handler || !module) continue;
    callerSources.push({ entry, body: registration.handler, module });
  }

  const reachableCalls = new Map<string, BackendCall[]>();
  for (const { entry, body, module } of callerSources) {
    reachableCalls.set(
      entry.id,
      collectReachableBackendCalls(
        module,
        body,
        moduleByConvexPath,
        knownConvexPaths,
      ),
    );
  }

  for (const { entry } of callerSources) {
    for (const call of reachableCalls.get(entry.id) ?? []) {
      const disposition: CallerTableRow["disposition"] =
        call.calleeRoot === "internal"
          ? "already-internal"
          : clientSourceText.includes(call.callee.replace(/^api\./, ""))
            ? "keep-public+internal-sibling"
            : "internalize";
      callerTable.push({
        ingressId: entry.id,
        ingressKind: entry.kind,
        filePath: call.filePath,
        line: call.line,
        callee: call.callee,
        calleeRoot: call.calleeRoot,
        idArgs: call.idArgs,
        disposition,
      });
    }
  }
  // Intra-backend `api.*` self-calls outside a route/action body (a mutation or
  // query re-entering the public surface) belong in the same table: they need
  // the same internalize / keep-public+internal-sibling disposition.
  const coveredSites = new Set(
    callerTable.map((row) => `${row.filePath}:${row.line}:${row.callee}`),
  );
  for (const module of modules) {
    for (const site of apiSelfCallSitesByModule.get(module.convexPath) ?? []) {
      const key = `${site.filePath}:${site.line}:${site.reference}`;
      if (coveredSites.has(key)) continue;
      coveredSites.add(key);
      const enclosing = ingress.find(
        (entry) =>
          entry.filePath === site.filePath &&
          entry.kind !== "registrar" &&
          entry.line <= site.line,
      );
      callerTable.push({
        ingressId: enclosing
          ? `${module.moduleName} (via ${enclosing.kind})`
          : module.moduleName,
        ingressKind: enclosing?.kind ?? "mutation",
        filePath: site.filePath,
        line: site.line,
        callee: site.reference,
        calleeRoot: "api",
        idArgs: [],
        disposition: clientSourceText.includes(
          site.reference.replace(/^api\./, ""),
        )
          ? "keep-public+internal-sibling"
          : "internalize",
      });
    }
  }

  callerTable.sort(
    (left, right) =>
      left.ingressId.localeCompare(right.ingressId) ||
      left.callee.localeCompare(right.callee),
  );

  // --- downstream writes ---------------------------------------------------
  const demoAdmittedTargets = new Map<string, string>();
  for (const definition of definitions) {
    const kind = definitionKind(definition);
    if (kind !== "action" && kind !== "http") continue;
    if (definition.actors?.sharedDemo !== "admit") continue;
    const target = definitionTargetId(definition);
    if (target) demoAdmittedTargets.set(target, definition.operationId ?? target);
  }

  const downstreamWrites: DownstreamWriteRow[] = [];
  for (const { entry } of callerSources) {
    const operationId = demoAdmittedTargets.get(entry.id);
    if (!operationId) continue;
    const seen = new Set<string>();
    const queue: { reference: string; depth: number }[] = (
      reachableCalls.get(entry.id) ?? []
    )
      .filter((call) => call.calleeRoot === "internal")
      .map((call) => ({ reference: call.callee, depth: 1 }));

    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || seen.has(next.reference) || next.depth > 4) continue;
      seen.add(next.reference);
      const resolved = resolveInternalReference(
        next.reference,
        moduleByConvexPath,
      );
      if (!resolved) continue;
      if (resolved.registration === "internalMutation") {
        downstreamWrites.push({
          ingressId: entry.id,
          ingressKind: entry.kind,
          operationId,
          internalMutation: next.reference,
          depth: next.depth,
        });
      }
      if (resolved.body && resolved.module) {
        for (const call of collectReachableBackendCalls(
          resolved.module,
          resolved.body,
          moduleByConvexPath,
          knownConvexPaths,
        )) {
          if (call.calleeRoot === "internal") {
            queue.push({ reference: call.callee, depth: next.depth + 1 });
          }
        }
      }
    }
  }
  downstreamWrites.sort(
    (left, right) =>
      left.ingressId.localeCompare(right.ingressId) ||
      left.internalMutation.localeCompare(right.internalMutation),
  );

  // --- path filter ---------------------------------------------------------
  const prefixes = options.paths ?? [];
  const inScope = (finding: OperationAdmissionFinding) =>
    prefixes.length === 0 ||
    prefixes.some((prefix) =>
      toConvexRelativePath(finding.filePath).startsWith(prefix),
    );

  return {
    ingress,
    admitted: ingress.filter((entry) => entry.admitted),
    raw: ingress.filter(
      (entry) => !entry.admitted && entry.kind !== "registrar",
    ),
    findings: findings.filter(inScope),
    partition,
    orphanFiles,
    callerTable,
    downstreamWrites,
  };
}

function findExportedHandlerBody(
  sourceFile: ts.SourceFile,
  exportName: string | undefined,
) {
  if (!exportName) return undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== exportName ||
        !declaration.initializer
      ) {
        continue;
      }
      const initializer = unwrapTypeOnly(declaration.initializer);
      if (!ts.isCallExpression(initializer)) continue;
      return handlerExpression(initializer) ?? initializer;
    }
  }
  return undefined;
}

function resolveInternalReference(
  reference: string,
  moduleByConvexPath: ReadonlyMap<string, ConvexModule>,
) {
  const parts = reference.replace(/^internal\./, "").split(".");
  if (parts.length < 2) return undefined;
  const exportName = parts[parts.length - 1];
  const modulePath = parts.slice(0, -1).join("/");
  const module = ENTRY_POINT_EXTENSIONS.map((extension) =>
    moduleByConvexPath.get(`${modulePath}${extension}`),
  ).find(Boolean);
  if (!module) return undefined;

  for (const statement of module.sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== exportName ||
        !declaration.initializer
      ) {
        continue;
      }
      const initializer = unwrapTypeOnly(declaration.initializer);
      if (!ts.isCallExpression(initializer)) continue;
      const callee = unwrapTypeOnly(initializer.expression);
      const registration = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      return {
        registration,
        module,
        body: handlerExpression(initializer),
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type CliOptions = {
  paths: string[];
  partition: boolean;
  callers: boolean;
  downstreamWrites: boolean;
};

export function parseCliArguments(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    paths: [],
    partition: false,
    callers: false,
    downstreamWrites: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--partition") options.partition = true;
    else if (argument === "--callers") options.callers = true;
    else if (argument === "--downstream-writes") options.downstreamWrites = true;
    else if (argument === "--path") {
      while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
        index += 1;
        options.paths.push(argv[index]);
      }
    } else if (argument.startsWith("--path=")) {
      options.paths.push(argument.slice("--path=".length));
    }
  }
  return options;
}

function formatFinding(finding: OperationAdmissionFinding) {
  const location = finding.line
    ? `${finding.filePath}:${finding.line}`
    : finding.filePath;
  const functionName = finding.functionName ? ` ${finding.functionName}` : "";
  return `${location} [${finding.severity}]${functionName} ${finding.title}\n  ${finding.rationale}\n  ${finding.remediation}`;
}

export async function runCli(
  repoRoot: string,
  argv: readonly string[],
): Promise<number> {
  const options = parseCliArguments(argv);
  const result = await collectOperationAdmissionCheckResult(repoRoot, {
    paths: options.paths,
  });

  if (options.callers) {
    await writeFile(
      path.join(repoRoot, CALLER_TABLE_RELATIVE_PATH),
      formatCallerTable(result.callerTable),
    );
    console.log(
      `Wrote ${CALLER_TABLE_RELATIVE_PATH} (${result.callerTable.length} row(s)).`,
    );
  }

  if (options.downstreamWrites) {
    await writeFile(
      path.join(repoRoot, DOWNSTREAM_WRITES_RELATIVE_PATH),
      formatDownstreamWrites(result.downstreamWrites),
    );
    console.log(
      `Wrote ${DOWNSTREAM_WRITES_RELATIVE_PATH} (${result.downstreamWrites.length} row(s)).`,
    );
  }

  if (options.partition) {
    console.log(formatPartitionReport(result));
    if (result.orphanFiles.length > 0) {
      console.error(
        `Ownership partition has ${result.orphanFiles.length} orphan file(s); every file exposing ingress must belong to exactly one unit.`,
      );
      return 1;
    }
  }

  const counts = result.ingress.reduce<Record<string, number>>(
    (accumulator, entry) => {
      accumulator[entry.kind] = (accumulator[entry.kind] ?? 0) + 1;
      return accumulator;
    },
    {},
  );
  const rawCounts = result.raw.reduce<Record<string, number>>(
    (accumulator, entry) => {
      accumulator[entry.kind] = (accumulator[entry.kind] ?? 0) + 1;
      return accumulator;
    },
    {},
  );

  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(formatFinding(finding));
    }
    console.error(
      `Operation admission coverage failed: ${result.findings.length} finding(s). Discovered ${JSON.stringify(counts)}; unadmitted ${JSON.stringify(rawCounts)}.`,
    );
    return 1;
  }

  console.log(
    `Operation admission coverage passed: every ingress admitted. Discovered ${JSON.stringify(counts)}.`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await runCli(DEFAULT_REPO_ROOT, process.argv.slice(2)));
}
