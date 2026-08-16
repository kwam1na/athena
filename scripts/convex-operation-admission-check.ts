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
 * Flags:
 *   --path <prefix...>    restrict findings to convex-relative path prefixes
 *   --partition           print the per-unit ownership table; fail on orphans
 *   --callers             write docs/plans/2026-08-16-002-backend-caller-table.md
 *   --downstream-writes   write docs/plans/2026-08-16-002-downstream-writes.md
 */
import { existsSync } from "node:fs";
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
   * `true` when a wrapper call exists inside the handler but not as the
   * handler expression or its first unconditional statement — work runs
   * before the caller is admitted.
   */
  wrapperNotFirst?: boolean;
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
const COMPOSITION_ROOT_SUFFIX = "platform/operationAdmission";

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
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RUN_METHODS = new Set(["runQuery", "runMutation", "runAction"]);
const SCHEDULER_METHODS = new Set(["runAfter", "runAt"]);

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

function isExcludedConvexSourcePath(filePath: string) {
  const normalized = normalizeRepoPath(filePath);
  return (
    !normalized.endsWith(".ts") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".d.ts") ||
    normalized.includes("/_generated/")
  );
}

function toConvexRelativePath(filePath: string) {
  return normalizeRepoPath(filePath).replace(
    /^.*packages\/athena-webapp\/convex\//,
    "",
  );
}

function toConvexModuleName(filePath: string) {
  return toConvexRelativePath(filePath).replace(/\.ts$/, "");
}

function parseSource(filePath: string, source: string) {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
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
    if (!clause) continue;
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
 * a convex-relative path with `.ts`.
 */
function resolveModuleSpecifier(
  fromConvexPath: string,
  specifier: string,
  knownConvexPaths?: ReadonlySet<string>,
) {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromConvexPath), specifier),
  );
  if (resolved.endsWith(".ts")) return resolved;
  const file = `${resolved}.ts`;
  const index = `${resolved}/index.ts`;
  if (!knownConvexPaths) return file;
  if (knownConvexPaths.has(file)) return file;
  // Directory import: `./routes` resolves to `./routes/index.ts`.
  if (knownConvexPaths.has(index)) return index;
  return file;
}

// ---------------------------------------------------------------------------
// Wrapper recognition
// ---------------------------------------------------------------------------

type WrapperNames = {
  /** local name -> ingress kind, imported from the composition root. */
  canonical: Map<string, IngressKind>;
  /** local name -> ingress kind, but imported from somewhere else. */
  offComposition: Map<string, IngressKind>;
  /** Local consts bound to a wrapper call: name -> ingress kind. */
  bound: Map<string, IngressKind>;
};

function collectWrapperNames(sourceFile: ts.SourceFile): WrapperNames {
  const canonical = new Map<string, IngressKind>();
  const offComposition = new Map<string, IngressKind>();
  const bound = new Map<string, IngressKind>();

  const recognized: Record<string, IngressKind> = { ...CANONICAL_WRAPPERS };

  for (const binding of collectImportBindings(sourceFile)) {
    const kind = recognized[binding.imported];
    if (!kind) continue;
    const fromRoot = binding.moduleSpecifier.endsWith(COMPOSITION_ROOT_SUFFIX);
    (fromRoot ? canonical : offComposition).set(binding.local, kind);
  }

  const all = new Map([...canonical, ...offComposition]);

  function wrapperKindOfCall(node: ts.Node): IngressKind | undefined {
    if (!ts.isCallExpression(node)) return undefined;
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return all.get(callee.text);
    if (ts.isPropertyAccessExpression(callee)) {
      return all.get(callee.name.text) ?? recognized[callee.name.text];
    }
    return undefined;
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }
      const kind = wrapperKindOfCall(declaration.initializer);
      if (kind) bound.set(declaration.name.text, kind);
    }
  }

  return { canonical, offComposition, bound };
}

function isPublicDbWriteCall(node: ts.Node) {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return false;
  if (
    !["delete", "insert", "patch", "replace"].includes(expression.name.text)
  ) {
    return false;
  }
  const target = expression.expression;
  return ts.isPropertyAccessExpression(target) && target.name.text === "db";
}

/**
 * Work an inline handler must not do before admission.
 *
 * The earlier rule only rejected a public `ctx.db` write ahead of the wrapper,
 * which let a handler read the database, call another Convex function, or
 * schedule work before the caller had been admitted. Reading before admission
 * is a disclosure, and `ctx.runMutation` before admission is a write by
 * another name — neither is caught by looking for `ctx.db.insert`.
 */
function isPreAdmissionCtxEffect(node: ts.Node) {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return false;

  const method = expression.name.text;
  const target = expression.expression;

  // ctx.runQuery / ctx.runMutation / ctx.runAction
  if (
    ["runQuery", "runMutation", "runAction"].includes(method) &&
    ts.isIdentifier(target)
  ) {
    return true;
  }

  if (!ts.isPropertyAccessExpression(target)) return false;
  // ctx.db.* (any access, read or write) and ctx.scheduler.*
  return target.name.text === "db" || target.name.text === "scheduler";
}

/**
 * The statement list an inline handler body runs, or `undefined` for a
 * concise arrow body (`(ctx, args) => admitPublicMutation(...)(ctx, args)`),
 * which has no statements that could precede the wrapper.
 */
function handlerBodyStatements(
  expression: ts.ArrowFunction | ts.FunctionExpression,
): readonly ts.Statement[] | undefined {
  return ts.isBlock(expression.body) ? expression.body.statements : undefined;
}

/**
 * Is `statement` the wrapper invocation itself, rather than something that
 * merely contains one somewhere inside a branch or a nested closure?
 *
 * Accepted: `return admit…(def, fn)(ctx, args);`, `await admit…(def, fn)(…)`,
 * a bare expression statement of the same, `const x = admit…(def, fn)`, and a
 * `try` whose block STARTS with one of those — the catch-and-reshape pattern
 * in `convex/notifications/subscriptions.ts`, where a typed admission denial
 * is mapped to a `CommandResult` and every other error rethrown. Nothing runs
 * before the wrapper there, so the positional guarantee holds.
 *
 * Rejected: a wrapper inside an `if`, a loop, or a callback, or anywhere after
 * another statement — an admission that only happens on some paths, or that
 * happens after work, is not admission.
 */
function statementWrapperMatch(
  statement: ts.Statement,
  names: WrapperNames,
): WrapperMatch | undefined {
  if (ts.isTryStatement(statement)) {
    const first = statement.tryBlock.statements[0];
    return first ? statementWrapperMatch(first, names) : undefined;
  }

  let expression: ts.Expression | undefined;
  if (ts.isReturnStatement(statement)) expression = statement.expression;
  else if (ts.isExpressionStatement(statement)) expression = statement.expression;
  else if (ts.isVariableStatement(statement)) {
    expression = statement.declarationList.declarations[0]?.initializer;
  } else return undefined;

  // Unwrap `await x` and the outer `(...)(ctx, args)` application.
  for (let depth = 0; depth < 4 && expression; depth += 1) {
    const direct = matchDirectWrapper(expression, names);
    if (direct) return direct;
    if (ts.isAwaitExpression(expression)) {
      expression = expression.expression;
      continue;
    }
    if (ts.isCallExpression(expression)) {
      expression = expression.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(expression)) {
      expression = expression.expression;
      continue;
    }
    if (ts.isIdentifier(expression)) {
      const kind = names.bound.get(expression.text);
      return kind
        ? { wrapper: expression.text, kind, fromRoot: true }
        : undefined;
    }
    return undefined;
  }
  return undefined;
}

type WrapperMatch = {
  wrapper: string;
  kind: IngressKind;
  fromRoot: boolean;
  /**
   * A wrapper was found inside an inline handler, but not as the handler
   * expression and not as the first unconditional statement — so work can run
   * before the caller is admitted.
   */
  notFirst?: boolean;
};

/**
 * Decide whether `expression` routes through an admission wrapper.
 *
 * Accepts a direct wrapper call, an identifier bound to one, or an inline
 * handler whose FIRST unconditional statement is the wrapper invocation.
 *
 * The rule is positional on purpose. "The wrapper is called somewhere in this
 * body" is not admission: a statement before it runs for an un-admitted
 * caller, and a wrapper call nested in an `if` or a `try` runs only on some
 * paths. The earlier version of this function walked the whole body and only
 * objected to a public `ctx.db` write appearing first, which accepted handlers
 * that read the database or called `ctx.runMutation` ahead of admission.
 */
function matchWrapper(
  expression: ts.Expression | undefined,
  names: WrapperNames,
): WrapperMatch | undefined {
  if (!expression) return undefined;

  const direct = matchDirectWrapper(expression, names);
  if (direct) return direct;

  if (ts.isIdentifier(expression)) {
    const kind = names.bound.get(expression.text);
    return kind
      ? { wrapper: expression.text, kind, fromRoot: true }
      : undefined;
  }

  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    const statements = handlerBodyStatements(expression);

    // Concise arrow body: `(ctx, args) => admitPublicMutation(def, fn)(ctx, args)`.
    // Nothing can precede the wrapper, so unwrap and accept.
    if (!statements) {
      let body = expression.body as ts.Expression;
      for (let depth = 0; depth < 4; depth += 1) {
        const match = matchDirectWrapper(body, names);
        if (match) return match;
        if (ts.isAwaitExpression(body) || ts.isParenthesizedExpression(body)) {
          body = body.expression;
          continue;
        }
        if (ts.isCallExpression(body)) {
          body = body.expression;
          continue;
        }
        break;
      }
      return undefined;
    }

    const first = statements[0];
    if (first) {
      const match = statementWrapperMatch(first, names);
      if (match) return match;
    }

    // A wrapper exists somewhere deeper in the body. Report it as a positional
    // failure rather than silently accepting or silently rejecting: "not
    // admitted at all" and "admitted too late" need different remediation.
    let deep: WrapperMatch | undefined;
    const visit = (node: ts.Node) => {
      if (deep) return;
      const nested = matchDirectWrapper(node, names);
      if (nested) {
        deep = nested;
        return;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const kind = names.bound.get(node.expression.text);
        if (kind) {
          deep = { wrapper: node.expression.text, kind, fromRoot: true };
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(expression.body);
    return deep ? { ...deep, notFirst: true } : undefined;
  }

  return undefined;
}

function matchDirectWrapper(
  node: ts.Node,
  names: WrapperNames,
): WrapperMatch | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  if (!name) return undefined;
  const canonicalKind = names.canonical.get(name);
  if (canonicalKind) {
    return { wrapper: name, kind: canonicalKind, fromRoot: true };
  }
  const offKind = names.offComposition.get(name);
  if (offKind) return { wrapper: name, kind: offKind, fromRoot: false };
  return undefined;
}

// ---------------------------------------------------------------------------
// Convex function ingress discovery
// ---------------------------------------------------------------------------

function getConvexRegistrationNames(sourceFile: ts.SourceFile) {
  const byLocalName = new Map<string, IngressKind>();
  const serverNamespaces = new Set<string>();

  for (const binding of collectImportBindings(sourceFile)) {
    if (!binding.moduleSpecifier.endsWith("_generated/server")) continue;
    if (binding.imported === "*") {
      serverNamespaces.add(binding.local);
      continue;
    }
    if (binding.imported === "mutation") byLocalName.set(binding.local, "mutation");
    if (binding.imported === "query") byLocalName.set(binding.local, "query");
    if (binding.imported === "action") byLocalName.set(binding.local, "action");
  }

  return { byLocalName, serverNamespaces };
}

function registrationKind(
  expression: ts.Expression,
  byLocalName: ReadonlyMap<string, IngressKind>,
  serverNamespaces: ReadonlySet<string>,
): IngressKind | undefined {
  if (ts.isIdentifier(expression)) return byLocalName.get(expression.text);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    serverNamespaces.has(expression.expression.text)
  ) {
    const name = expression.name.text;
    if (name === "mutation" || name === "query" || name === "action") {
      return name;
    }
  }
  return undefined;
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
 * Discover exported public Convex functions and destructured framework
 * registrar exports in one source file.
 */
export function collectConvexIngressFromSource(
  filePath: string,
  source: string,
): IngressRegistration[] {
  if (isExcludedConvexSourcePath(filePath)) return [];

  const sourceFile = parseSource(filePath, source);
  const { byLocalName, serverNamespaces } =
    getConvexRegistrationNames(sourceFile);
  const wrapperNames = collectWrapperNames(sourceFile);
  const moduleName = toConvexModuleName(filePath);
  const normalized = normalizeRepoPath(filePath);
  const registrarLocals = collectRegistrarLocalNames(sourceFile);
  const found: IngressRegistration[] = [];

  const push = (
    exportName: string,
    node: ts.Node,
    kind: IngressKind,
    call: ts.CallExpression | undefined,
  ) => {
    const match = call
      ? matchWrapper(handlerExpression(call), wrapperNames)
      : undefined;
    found.push({
      id: `${moduleName}:${exportName}`,
      kind,
      filePath: normalized,
      line: lineOf(sourceFile, node),
      moduleName,
      exportName,
      wrapper: match?.wrapper,
      wrapperOffComposition: match ? !match.fromRoot : undefined,
      wrapperNotFirst: match?.notFirst,
      // A late wrapper is not admission: work already ran for an un-admitted
      // caller, so this counts as unadmitted AND raises its own finding.
      admitted: Boolean(match) && !match?.notFirst,
    });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue;

        // export const { auth, signIn, ... } = convexAuth({...})
        if (
          ts.isObjectBindingPattern(declaration.name) &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          registrarLocals.has(declaration.initializer.expression.text)
        ) {
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

        if (!ts.isIdentifier(declaration.name)) continue;
        if (!ts.isCallExpression(declaration.initializer)) continue;
        const kind = registrationKind(
          declaration.initializer.expression,
          byLocalName,
          serverNamespaces,
        );
        if (!kind) continue;
        push(
          declaration.name.text,
          declaration,
          kind,
          declaration.initializer,
        );
      }
      continue;
    }

    if (
      ts.isExportAssignment(statement) &&
      ts.isCallExpression(statement.expression)
    ) {
      const kind = registrationKind(
        statement.expression.expression,
        byLocalName,
        serverNamespaces,
      );
      if (kind) push("default", statement, kind, statement.expression);
    }
  }

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
  /** A wrapper exists but runs after other work — see `matchWrapper`. */
  wrapperNotFirst?: boolean;
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
};

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
  const importBindings = collectImportBindings(sourceFile);

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (!isHonoRouterDeclaration(declaration)) continue;
        routerVariables.add(declaration.name.text);
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

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;

      if (method === "addHttpRoutes") {
        addHttpRoutesCalls.push({ line: lineOf(sourceFile, node) });
      }

      if (ts.isIdentifier(receiver) && routerVariables.has(receiver.text)) {
        const routerKey = `${convexPath}#${receiver.text}`;

        if (method === "route") {
          const prefix = stringLiteralText(node.arguments[0]);
          const child = node.arguments[1];
          if (prefix !== undefined && child && ts.isIdentifier(child)) {
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
        } else if (HTTP_VERBS.has(method)) {
          const localPath = stringLiteralText(node.arguments[0]);
          if (localPath !== undefined) {
            const handler = node.arguments[node.arguments.length - 1];
            const match = matchWrapper(handler, wrapperNames);
            registrations.push({
              routerKey,
              method: method === "all" ? "ALL" : method.toUpperCase(),
              localPath,
              filePath,
              line: lineOf(sourceFile, node),
              handler,
              admitted: Boolean(match) && !match?.notFirst,
              wrapperNotFirst: match?.notFirst,
              wrapper: match?.wrapper,
              wrapperFromRoot: match?.fromRoot ?? true,
              wrapperKind: match?.kind,
            });
          }
        } else if (method === "on") {
          const methodsArg = node.arguments[0];
          const localPath = stringLiteralText(node.arguments[1]);
          const methods: string[] = [];
          if (methodsArg && ts.isArrayLiteralExpression(methodsArg)) {
            for (const element of methodsArg.elements) {
              const text = stringLiteralText(element);
              if (text) methods.push(text.toUpperCase());
            }
          } else {
            const single = stringLiteralText(methodsArg);
            if (single) methods.push(single.toUpperCase());
          }
          if (localPath !== undefined && methods.length > 0) {
            const handler = node.arguments[node.arguments.length - 1];
            const match = matchWrapper(handler, wrapperNames);
            for (const httpMethod of methods) {
              registrations.push({
                routerKey,
                method: httpMethod,
                localPath,
                filePath,
                line: lineOf(sourceFile, node),
                handler,
                admitted: Boolean(match) && !match?.notFirst,
                wrapperNotFirst: match?.notFirst,
                wrapper: match?.wrapper,
                wrapperFromRoot: match?.fromRoot ?? true,
                wrapperKind: match?.kind,
              });
            }
          }
        }
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
  };
}

/**
 * Resolve every route registration to its full mounted path by walking the
 * router graph from `convex/http.ts`'s root router.
 */
function resolveRouteRegistrations(
  facts: Map<string, RouteModuleFacts>,
): { routes: IngressRegistration[]; registrations: Map<string, RawRouteRegistration> } {
  // exported name resolution, with re-export forwarding to a fixpoint.
  const exportIndex = new Map<string, string>(); // `${convexPath}::${name}` -> routerKey
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
          if (owner !== target) continue;
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
        wrapperNotFirst: registration.wrapperNotFirst,
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
        wrapperNotFirst: registration.wrapperNotFirst,
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
 * Resolve `api`-rooted references through AST bindings — import aliases,
 * namespace imports, intermediate consts, and object destructuring — so an
 * alias cannot smuggle a public self-call past the ban.
 */
export function collectApiSelfCallSites(
  filePath: string,
  source: string,
): ApiSelfCallSite[] {
  if (isExcludedConvexSourcePath(filePath)) return [];
  const sourceFile = parseSource(filePath, source);

  const apiRoots = new Set<string>();
  const namespaceRoots = new Set<string>();
  for (const binding of collectImportBindings(sourceFile)) {
    if (!binding.moduleSpecifier.endsWith("_generated/api")) continue;
    if (binding.imported === "api") apiRoots.add(binding.local);
    if (binding.imported === "*") namespaceRoots.add(binding.local);
  }
  if (apiRoots.size === 0 && namespaceRoots.size === 0) return [];

  const referenceText = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node)) {
      return apiRoots.has(node.text) ? node.text : undefined;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        namespaceRoots.has(node.expression.text) &&
        node.name.text === "api"
      ) {
        return `${node.expression.text}.api`;
      }
      const parent = referenceText(node.expression);
      return parent ? `${parent}.${node.name.text}` : undefined;
    }
    if (ts.isElementAccessExpression(node)) {
      const parent = referenceText(node.expression);
      const index = stringLiteralText(node.argumentExpression);
      return parent && index ? `${parent}.${index}` : undefined;
    }
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
      return referenceText(node.expression);
    }
    return undefined;
  };

  // Widen the root set through local bindings until it stops growing.
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    const visitBindings = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const resolved = referenceText(node.initializer);
        if (resolved) {
          if (ts.isIdentifier(node.name) && !apiRoots.has(node.name.text)) {
            apiRoots.add(node.name.text);
            changed = true;
          } else if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              if (
                ts.isIdentifier(element.name) &&
                !apiRoots.has(element.name.text)
              ) {
                apiRoots.add(element.name.text);
                changed = true;
              }
            }
          }
        }
      }
      ts.forEachChild(node, visitBindings);
    };
    visitBindings(sourceFile);
    if (!changed) break;
  }

  const sites: ApiSelfCallSite[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      const isRun = RUN_METHODS.has(method);
      const isScheduler =
        SCHEDULER_METHODS.has(method) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === "scheduler";
      if (isRun || isScheduler) {
        const argument = node.arguments[isScheduler ? 1 : 0];
        const reference = argument ? referenceText(argument) : undefined;
        if (reference) {
          sites.push({
            filePath: normalizeRepoPath(filePath),
            line: lineOf(sourceFile, node),
            reference,
            via: method,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

// ---------------------------------------------------------------------------
// CORS allowlist assertion
// ---------------------------------------------------------------------------

export type CorsAssertion = {
  found: boolean;
  allowlisted: boolean;
  line?: number;
  detail: string;
};

/**
 * The router's CORS middleware is the ONLY `.use` the checker inspects: a
 * `SameSite=None` claim cookie plus a reflect-any-origin callback is a
 * cross-origin write primitive, so the origin must be a fixed allowlist.
 */
export function assertCorsAllowlist(
  filePath: string,
  source: string,
): CorsAssertion {
  const sourceFile = parseSource(filePath, source);
  let assertion: CorsAssertion = {
    found: false,
    allowlisted: false,
    detail: "No CORS middleware registration found in the router.",
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "cors"
    ) {
      const [config] = node.arguments;
      const line = lineOf(sourceFile, node);
      if (!config || !ts.isObjectLiteralExpression(config)) {
        assertion = {
          found: true,
          allowlisted: false,
          line,
          detail: "cors() was called without an inspectable config object.",
        };
        return;
      }
      const originProperty = config.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "origin",
      ) as ts.PropertyAssignment | undefined;

      if (!originProperty) {
        assertion = {
          found: true,
          allowlisted: false,
          line,
          detail: "cors() config declares no `origin`, so Hono reflects `*`.",
        };
        return;
      }

      const value = originProperty.initializer;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        assertion = {
          found: true,
          allowlisted: false,
          line,
          detail:
            "cors() `origin` is a callback; a reflect-any-origin callback with credentials is not an allowlist.",
        };
        return;
      }
      const literal = stringLiteralText(value);
      if (literal === "*") {
        assertion = {
          found: true,
          allowlisted: false,
          line,
          detail: 'cors() `origin` is the wildcard "*".',
        };
        return;
      }
      assertion = {
        found: true,
        allowlisted: true,
        line,
        detail: "cors() `origin` resolves to a fixed allowlist value.",
      };
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return assertion;
}

// ---------------------------------------------------------------------------
// Definition loading + matching
// ---------------------------------------------------------------------------

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

async function listConvexSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "_generated" ? [] : listConvexSourceFiles(entryPath);
      }
      return entry.isFile() && !isExcludedConvexSourcePath(entryPath)
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
  const convexIngress = modules.flatMap((module) =>
    collectConvexIngressFromSource(module.filePath, module.source),
  );

  const knownConvexPaths = new Set(modules.map((entry) => entry.convexPath));
  const routeFacts = new Map<string, RouteModuleFacts>();
  for (const module of modules) {
    routeFacts.set(
      module.convexPath,
      collectRouteModuleFacts(
        module,
        collectWrapperNames(module.sourceFile),
        knownConvexPaths,
      ),
    );
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

  for (const entry of ingress) {
    if (entry.kind === "registrar") continue;
    const matches = definitionByTarget.get(entry.id) ?? [];
    const kindMatched = matches.filter((definition) => {
      const kind = definitionKind(definition);
      return kind === undefined || kind === entry.kind;
    });

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

    if (entry.wrapperNotFirst) {
      push({
        id: `wrapper-not-first-${slugifyForFindingId(entry.id)}`,
        severity: "high",
        title: "Admission wrapper does not run first in the handler",
        filePath: entry.filePath,
        line: entry.line,
        functionName: entry.id,
        rationale:
          "The wrapper is called somewhere inside the handler rather than as the handler itself or its first unconditional statement. Any statement ahead of it runs for a caller who has not been admitted, and a wrapper nested in a branch or a try block admits on some paths only. Reading rows, calling ctx.runQuery/runMutation/runAction, or scheduling work before admission defeats the rail even when no direct ctx.db write is involved.",
        remediation:
          "Make the canonical wrapper the handler expression itself, or the first statement of the handler body. If the handler needs to translate a denial into a CommandResult, wrap the wrapper call in a catch rather than doing work before it (see convex/notifications/subscriptions.ts).",
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
  for (const module of modules) {
    for (const site of collectApiSelfCallSites(module.filePath, module.source)) {
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

  // --- CORS allowlist ------------------------------------------------------
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
    for (const site of collectApiSelfCallSites(module.filePath, module.source)) {
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
        !declaration.initializer ||
        !ts.isCallExpression(declaration.initializer)
      ) {
        continue;
      }
      return handlerExpression(declaration.initializer) ?? declaration.initializer;
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
  const convexPath = `${parts.slice(0, -1).join("/")}.ts`;
  const module = moduleByConvexPath.get(convexPath);
  if (!module) return undefined;

  for (const statement of module.sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== exportName ||
        !declaration.initializer ||
        !ts.isCallExpression(declaration.initializer)
      ) {
        continue;
      }
      const callee = declaration.initializer.expression;
      const registration = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      return {
        registration,
        module,
        body: handlerExpression(declaration.initializer),
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
