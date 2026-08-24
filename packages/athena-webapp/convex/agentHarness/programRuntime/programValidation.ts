"use node";
/**
 * Athena-owned static program validation: Athena-owned static TypeScript/AST
 * validation and explicit-output rules layered around the sandbox.
 *
 * Runs outside the sandbox, before any domain read, on the TypeScript AST
 * (`@babel/parser`, exact-pinned; the full `typescript` checker was measured
 * at ~12 MB of Node bundle against Convex's 32 MiB per-deployment code cap
 * and rejected — see `docs/agent/agent-harness-runtime.md`):
 * - size ceiling, then a TypeScript parse (syntax errors reject);
 * - AST policy: no imports/exports/dynamic import, no `with`/`debugger`/
 *   classes/`new.target`/`import.meta`, no `this`, no free identifier outside
 *   the allowlist (host, network, fs, eval/Function, timers, clock,
 *   randomness, Reflect/Proxy are therefore unreachable by name), no
 *   prototype or mutation-handle member access (`constructor`, `__proto__`,
 *   `prototype`, `Math.random`, ...);
 * - facade shape: `athena.<package>.<resource>.<verb>(args)` must be a fully
 *   qualified call on a granted path with at most one non-literal-scalar
 *   argument; aliasing, partial chains, computed access, or passing facade
 *   functions around are rejected, so type stripping cannot smuggle a
 *   mistyped facade use past Athena;
 * - exactly one explicit output: one top-level `return`, as the last statement;
 * - erasable-syntax type stripping (annotations, interfaces, aliases,
 *   `as`/`satisfies`/`!`, generics) by source range; non-erasable TypeScript
 *   (enums, namespaces, parameter properties, decorators, overloads) is
 *   rejected; the stripped program is re-parsed as plain JavaScript.
 *
 * Semantic type checking (assignability) is not performed; runtime argument
 * validation at the bridge (the capability SDK's `validateInput`, executor
 * admission) remains
 * authoritative for argument shapes.
 */
import { parse, type ParserOptions } from "@babel/parser";

import { measureUtf8Bytes } from "./outputCeiling";
import type { AgentProgramFacadeEntry, AgentProgramValidationIssue, AgentProgramValidationResult } from "./types";
import { AGENT_PROGRAM_RUNTIME_CEILINGS } from "./types";

export const AGENT_PROGRAM_ENTRY = "__athena_program" as const;

/** The only free identifiers a program may reference. Everything else is rejected by name. */
export const AGENT_PROGRAM_ALLOWED_GLOBALS = new Set([
  "athena",
  "Promise",
  "JSON",
  "Math",
  "Array",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Map",
  "Set",
  "Error",
  "TypeError",
  "RangeError",
  "undefined",
  "NaN",
  "Infinity",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "encodeURIComponent",
  "decodeURIComponent",
]);

/** Member names that reach prototypes, mutation handles, or nondeterminism. */
export const AGENT_PROGRAM_FORBIDDEN_MEMBERS = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "getPrototypeOf",
  "setPrototypeOf",
  "defineProperty",
  "defineProperties",
  "random",
]);

/**
 * Prelude helper calls a program may make besides the granted reads. These
 * are implemented wholly inside the sandbox prelude — no host bridge, no
 * budget charge — and take plain arguments rather than a filters object.
 */
export const HELPER_SIGNATURES: Record<string, string> = {
  "dates.shift": 'athena.dates.shift("YYYY-MM-DD", wholeDays)',
  "dates.range": 'athena.dates.range("YYYY-MM-DD", "YYYY-MM-DD")',
  "budget.remaining": "athena.budget.remaining()",
};
const HELPER_CALL_PATHS = new Set(Object.keys(HELPER_SIGNATURES));

export type ValidateProgramSourceOptions = {
  readonly facade: readonly AgentProgramFacadeEntry[];
  readonly maxSourceBytes?: number;
};

type BabelNode = {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: { line: number; column: number } } | null;
  [key: string]: unknown;
};

/** The parse wrapper is one line; the executable wrapper adds a `"use strict"` line after stripping. */
const WRAPPER_PREFIX_LINES = 1;
const STRICT_DIRECTIVE_LINE = '"use strict";';
const SKIPPED_KEYS = new Set(["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments", "range", "comments", "errors"]);

const PARSE_OPTIONS: ParserOptions = {
  sourceType: "script",
  plugins: ["typescript"],
  allowReturnOutsideFunction: false,
  allowAwaitOutsideFunction: false,
  errorRecovery: false,
  attachComment: false,
  ranges: false,
};

function wrap(source: string): string {
  return `async function ${AGENT_PROGRAM_ENTRY}() {\n${source}\n}\n`;
}

/** Programs execute in strict mode (frozen facade writes throw); the directive is added after policy analysis. */
function withStrictDirective(wrapped: string): string {
  const newline = wrapped.indexOf("\n");
  return `${wrapped.slice(0, newline + 1)}${STRICT_DIRECTIVE_LINE}\n${wrapped.slice(newline + 1)}`;
}

function isNode(value: unknown): value is BabelNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function children(node: BabelNode): Array<{ key: string; child: BabelNode }> {
  const out: Array<{ key: string; child: BabelNode }> = [];
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push({ key, child: item });
    } else if (isNode(value)) {
      out.push({ key, child: value });
    }
  }
  return out;
}

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod"]);

/** TS nodes that wrap an expression (erased around it); everything else starting with `TS` is a type context. */
const TS_EXPRESSION_WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression"]);

const REJECTED_SYNTAX: Record<string, string> = {
  ClassDeclaration: "class",
  ClassExpression: "class",
  WithStatement: "with",
  DebuggerStatement: "debugger",
  MetaProperty: "meta property",
  LabeledStatement: "label",
  TSEnumDeclaration: "enum",
  TSModuleDeclaration: "namespace",
  TSDeclareFunction: "declare",
  TSDeclareMethod: "declare",
  TSParameterProperty: "parameter property",
  TSImportEqualsDeclaration: "import",
  TSExportAssignment: "export",
  TSNamespaceExportDeclaration: "export",
  Decorator: "decorator",
  TSImportType: "import type",
};

type Range = [number, number];

function positionOf(node: BabelNode): { line?: number; column?: number } {
  if (!node.loc) return {};
  return { line: node.loc.start.line - WRAPPER_PREFIX_LINES, column: node.loc.start.column + 1 };
}

/** Identifiers that introduce a binding rather than reference one. */
function isBindingPosition(parent: BabelNode | undefined, key: string): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case "VariableDeclarator":
      return key === "id";
    case "FunctionDeclaration":
    case "FunctionExpression":
      return key === "id" || key === "params";
    case "ArrowFunctionExpression":
    case "ObjectMethod":
      return key === "params";
    case "CatchClause":
      return key === "param";
    case "AssignmentPattern":
      return key === "left";
    case "RestElement":
      return key === "argument";
    case "ArrayPattern":
      return key === "elements";
    default:
      return false;
  }
}

function collectPattern(pattern: BabelNode, into: Set<string>) {
  switch (pattern.type) {
    case "Identifier":
      into.add(pattern.name as string);
      break;
    case "AssignmentPattern":
      collectPattern(pattern.left as BabelNode, into);
      break;
    case "RestElement":
      collectPattern(pattern.argument as BabelNode, into);
      break;
    case "ArrayPattern":
      for (const element of pattern.elements as Array<BabelNode | null>) if (element) collectPattern(element, into);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties as BabelNode[]) {
        if (property.type === "RestElement") collectPattern(property.argument as BabelNode, into);
        else collectPattern(property.value as BabelNode, into);
      }
      break;
    default:
      break;
  }
}

function collectDeclaredNames(root: BabelNode): Set<string> {
  const declared = new Set<string>();
  const visit = (node: BabelNode) => {
    switch (node.type) {
      case "VariableDeclarator":
        collectPattern(node.id as BabelNode, declared);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
        if (node.id) collectPattern(node.id as BabelNode, declared);
        for (const param of node.params as BabelNode[]) collectPattern(param, declared);
        break;
      case "ArrowFunctionExpression":
      case "ObjectMethod":
        for (const param of node.params as BabelNode[]) collectPattern(param, declared);
        break;
      case "CatchClause":
        if (node.param) collectPattern(node.param as BabelNode, declared);
        break;
      default:
        break;
    }
    for (const { child } of children(node)) visit(child);
  };
  visit(root);
  return declared;
}

type FacadeIndex = Map<string, Map<string, Set<string>>>;

function indexFacade(facade: readonly AgentProgramFacadeEntry[]): FacadeIndex {
  const index: FacadeIndex = new Map();
  for (const entry of facade) {
    const resources = index.get(entry.package) ?? new Map<string, Set<string>>();
    const verbs = resources.get(entry.resource) ?? new Set<string>();
    for (const verb of entry.verbs) verbs.add(verb);
    resources.set(entry.resource, verbs);
    index.set(entry.package, resources);
  }
  return index;
}

/** Resolve a non-computed member chain rooted at an identifier into its segments. */
function memberChain(node: BabelNode): { root: BabelNode; segments: string[] } | undefined {
  const segments: string[] = [];
  let cursor: BabelNode = node;
  while (cursor.type === "MemberExpression" || cursor.type === "OptionalMemberExpression") {
    if (cursor.computed || (cursor.property as BabelNode).type !== "Identifier") return undefined;
    segments.unshift((cursor.property as BabelNode).name as string);
    cursor = cursor.object as BabelNode;
  }
  if (cursor.type !== "Identifier") return undefined;
  return { root: cursor, segments };
}

const SCALAR_LITERALS = new Set(["NumericLiteral", "StringLiteral", "BooleanLiteral", "NullLiteral", "BigIntLiteral", "TemplateLiteral", "ArrayExpression", "RegExpLiteral"]);

function isPropertyName(parent: BabelNode | undefined, key: string): boolean {
  if (!parent) return false;
  if ((parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && key === "property" && !parent.computed) return true;
  if ((parent.type === "ObjectProperty" || parent.type === "ObjectMethod") && key === "key" && !parent.computed) {
    return !(parent.type === "ObjectProperty" && parent.shorthand === true);
  }
  return false;
}

type Analysis = { issues: AgentProgramValidationIssue[]; deletions: Range[] };

function analyze(source: string, root: BabelNode, wrapper: BabelNode, facade: FacadeIndex): Analysis {
  const issues: AgentProgramValidationIssue[] = [];
  const deletions: Range[] = [];
  const topLevelReturns: BabelNode[] = [];
  const declared = collectDeclaredNames(wrapper);
  const facadeRoots = new Set<BabelNode>();
  const add = (code: AgentProgramValidationIssue["code"], node: BabelNode, message: string) => {
    issues.push({ code, message, ...positionOf(node) });
  };
  const erase = (node: BabelNode) => {
    if (typeof node.start === "number" && typeof node.end === "number") deletions.push([node.start, node.end]);
  };

  const grantedPaths = () => {
    const paths: string[] = [];
    for (const [pkg, resources] of facade) {
      for (const [resource, verbs] of resources) paths.push(`${pkg}.${resource}.${[...verbs].sort().join("|")}`);
    }
    return paths.sort().join(", ");
  };
  const checkFacadeUse = (node: BabelNode, parent: BabelNode | undefined, key: string) => {
    const chain = memberChain(node);
    if (!chain || (chain.root.name as string) !== "athena" || declared.has("athena")) return;
    facadeRoots.add(chain.root);
    const path = chain.segments.join(".");
    if (HELPER_CALL_PATHS.has(path)) {
      // Prelude helpers, not reads: they take plain arguments and cross no
      // bridge, so the facade's single-object-argument rule does not apply.
      if (!parent || parent.type !== "CallExpression" || key !== "callee") {
        add("facade_misuse", node, `\`athena.${path}\` must be called: ${HELPER_SIGNATURES[path]}.`);
      }
      return;
    }
    if (chain.segments.length !== 3 || !parent || parent.type !== "CallExpression" || key !== "callee") {
      // A wrong-arity path is a guessed namespace, not aliasing: name what is
      // actually granted so the correction is a lookup, not another guess.
      const hint =
        chain.segments.length > 0 && chain.segments.length !== 3
          ? ` Granted reads: ${grantedPaths()}. Helpers: ${Object.values(HELPER_SIGNATURES).join(", ")}.`
          : "";
      add("facade_misuse", node, `\`athena${path ? `.${path}` : ""}\` must be called as \`athena.<package>.<resource>.<verb>(args)\`; it cannot be aliased, assigned, passed, or partially applied.${hint}`);
      return;
    }
    const [pkg, resource, verb] = chain.segments;
    const verbs = facade.get(pkg)?.get(resource);
    if (!verbs || !verbs.has(verb)) add("facade_path_unknown", node, `\`athena.${path}\` is not part of the granted facade. Granted reads: ${grantedPaths()}.`);
    const args = parent.arguments as BabelNode[];
    if (args.length > 1) add("facade_args_invalid", node, "Facade calls take a single arguments object.");
    const [arg] = args;
    if (arg && (SCALAR_LITERALS.has(arg.type) || arg.type === "SpreadElement")) add("facade_args_invalid", arg, "Facade arguments must be an object.");
  };

  const visit = (node: BabelNode, parent: BabelNode | undefined, key: string, enclosingFunction: BabelNode, inType: boolean) => {
    const type = node.type;
    if (type.startsWith("TS") && !TS_EXPRESSION_WRAPPERS.has(type)) {
      if (type in REJECTED_SYNTAX) {
        add("unsupported_syntax", node, `TypeScript \`${REJECTED_SYNTAX[type]}\` is not supported in programs.`);
        return;
      }
      if (type === "TSInterfaceDeclaration" || type === "TSTypeAliasDeclaration" || type === "TSTypeAnnotation" || type === "TSTypeParameterDeclaration" || type === "TSTypeParameterInstantiation") {
        erase(node);
        return;
      }
      if (!inType) add("unsupported_syntax", node, `TypeScript syntax \`${type}\` is not supported in programs.`);
      return;
    }

    switch (type) {
      case "ImportDeclaration":
        add("import_forbidden", node, "Programs cannot import modules.");
        return;
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
        add("export_forbidden", node, "Programs cannot export.");
        return;
      case "Import":
      case "ImportExpression":
        add("import_forbidden", node, "Programs cannot import modules dynamically.");
        return;
      case "ThisExpression":
        add("forbidden_this", node, "`this` is not available to programs.");
        return;
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression": {
        const expression = node.expression as BabelNode;
        if (typeof expression.end === "number" && typeof node.end === "number") deletions.push([expression.end, node.end]);
        visit(expression, node, "expression", enclosingFunction, inType);
        return;
      }
      case "TSTypeAssertion": {
        const expression = node.expression as BabelNode;
        if (typeof node.start === "number" && typeof expression.start === "number") deletions.push([node.start, expression.start]);
        visit(expression, node, "expression", enclosingFunction, inType);
        return;
      }
      case "TSInstantiationExpression": {
        const expression = node.expression as BabelNode;
        if (isNode(node.typeParameters)) erase(node.typeParameters);
        visit(expression, node, "expression", enclosingFunction, inType);
        return;
      }
      default:
        break;
    }
    if (type in REJECTED_SYNTAX) {
      add("forbidden_syntax", node, `\`${REJECTED_SYNTAX[type]}\` is not allowed in programs.`);
      return;
    }

    if (type === "Identifier") {
      const name = node.name as string;
      if (node.optional === true || node.definite === true) {
        // The identifier's range spans its type annotation; the marker sits right after the name.
        const nameEnd = typeof node.start === "number" ? node.start + name.length : -1;
        const expected = node.optional ? "?" : "!";
        let marker = nameEnd;
        while (marker >= 0 && marker < source.length && /\s/.test(source[marker])) marker += 1;
        if (nameEnd >= 0 && source[marker] === expected) deletions.push([marker, marker + 1]);
      }
      const isReference = !isBindingPosition(parent, key) && !isPropertyName(parent, key) && !inType;
      if (isReference && !declared.has(name) && !AGENT_PROGRAM_ALLOWED_GLOBALS.has(name)) {
        add("forbidden_identifier", node, `\`${name}\` is not available to programs.`);
      }
      if (isReference && name === "athena" && !declared.has("athena") && !facadeRoots.has(node)) {
        add("facade_misuse", node, "`athena` must be called as `athena.<package>.<resource>.<verb>(args)`.");
      }
    }

    if (type === "MemberExpression" || type === "OptionalMemberExpression") {
      const property = node.property as BabelNode;
      if (!node.computed && property.type === "Identifier" && AGENT_PROGRAM_FORBIDDEN_MEMBERS.has(property.name as string)) {
        add("forbidden_member", node, `Member \`${property.name}\` is not available to programs.`);
      }
      if (node.computed && property.type === "StringLiteral" && AGENT_PROGRAM_FORBIDDEN_MEMBERS.has(property.value as string)) {
        add("forbidden_member", node, `Member \`${property.value}\` is not available to programs.`);
      }
      const parentIsChain = parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && key === "object";
      if (!parentIsChain) checkFacadeUse(node, parent, key);
    }

    if (type === "ReturnStatement" && enclosingFunction === wrapper) topLevelReturns.push(node);

    const nextEnclosing = FUNCTION_TYPES.has(type) && node !== wrapper ? node : enclosingFunction;
    for (const { key: childKey, child } of children(node)) {
      if (childKey === "typeAnnotation" || childKey === "returnType" || childKey === "typeParameters" || childKey === "superTypeParameters" || childKey === "implements") {
        erase(child);
        continue;
      }
      visit(child, node, childKey, nextEnclosing, inType);
    }
  };

  visit(root, undefined, "root", wrapper, false);

  const body = (wrapper.body as BabelNode).body as BabelNode[];
  if (topLevelReturns.length === 0) {
    add("missing_output", wrapper, "The program must end with exactly one `return` that is its explicit output.");
  } else if (topLevelReturns.length > 1) {
    for (const extra of topLevelReturns.slice(1)) add("multiple_outputs", extra, "Only one top-level `return` is allowed.");
  } else if (body[body.length - 1] !== topLevelReturns[0]) {
    add("unreachable_after_output", topLevelReturns[0], "The explicit output `return` must be the last top-level statement.");
  }
  return { issues, deletions };
}

function applyDeletions(text: string, deletions: Range[]): string {
  const sorted = [...deletions].sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  let out = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    out += text.slice(cursor, start);
    cursor = end;
  }
  return out + text.slice(cursor);
}

function syntaxIssue(error: unknown, wrapped?: string): AgentProgramValidationIssue {
  const loc = (error as { loc?: { line: number; column: number } } | null)?.loc;
  const position = (error as { pos?: number } | null)?.pos;
  const message = String((error as { message?: unknown } | null)?.message ?? "Invalid program syntax.").replace(/\s*\(\d+:\d+\)\s*$/, "");
  // `import`/`export` inside the program body are syntax errors to the parser; report them as the policy they break.
  let code: AgentProgramValidationIssue["code"] = "syntax_error";
  if (wrapped && typeof position === "number" && /import|export/i.test(message)) {
    const ahead = wrapped.slice(position, position + 8);
    if (ahead.startsWith("export")) code = "export_forbidden";
    else if (ahead.startsWith("import")) code = "import_forbidden";
  }
  return loc ? { code, message, line: loc.line - WRAPPER_PREFIX_LINES, column: loc.column + 1 } : { code, message };
}

export function validateProgramSource(source: string, options: ValidateProgramSourceOptions): AgentProgramValidationResult {
  const maxSourceBytes = options.maxSourceBytes ?? AGENT_PROGRAM_RUNTIME_CEILINGS.maxSourceBytes;
  const sourceBytes = measureUtf8Bytes(source);
  if (sourceBytes > maxSourceBytes) {
    return {
      ok: false,
      status: "rejected",
      issues: [{ code: "source_too_large", message: `Program source is ${sourceBytes} bytes; the ceiling is ${maxSourceBytes}.` }],
    };
  }

  const wrapped = wrap(source);
  let file: BabelNode;
  try {
    file = parse(wrapped, PARSE_OPTIONS) as unknown as BabelNode;
  } catch (error) {
    return { ok: false, status: "rejected", issues: [syntaxIssue(error, wrapped)] };
  }
  const program = file.program as BabelNode;
  const statements = program.body as BabelNode[];
  const wrapper = statements.find(
    (statement) => statement.type === "FunctionDeclaration" && ((statement.id as BabelNode | null)?.name as string | undefined) === AGENT_PROGRAM_ENTRY,
  );
  if (!wrapper || statements.length !== 1) {
    return { ok: false, status: "rejected", issues: [{ code: "syntax_error", message: "The program body could not be isolated." }] };
  }

  const analysis = analyze(wrapped, program, wrapper, indexFacade(options.facade));
  if (analysis.issues.length > 0) return { ok: false, status: "rejected", issues: analysis.issues };

  const stripped = applyDeletions(wrapped, analysis.deletions);
  try {
    parse(stripped, { sourceType: "script", plugins: [], errorRecovery: false, attachComment: false });
  } catch (error) {
    const issue = syntaxIssue(error);
    return { ok: false, status: "rejected", issues: [{ ...issue, message: `Type stripping produced invalid JavaScript: ${issue.message}` }] };
  }
  return { ok: true, source: withStrictDirective(stripped), sourceBytes };
}

// ---------------------------------------------------------------------------
// Advisory field scan (never blocks execution)
// ---------------------------------------------------------------------------

export type AgentProgramFieldAdvisory = {
  readonly namespace: string;
  readonly field: string;
  readonly message: string;
};

/**
 * Advisory scan for reads of result fields the capability does not declare:
 * `day.envelope.data.totalSales` when `reports.daySales` has no `totalSales`
 * yields `undefined`, the program returns `null`, and the model narrates a
 * misread as missing data. The scan resolves the simple binding forms programs
 * actually write — `const day = await athena.p.r.get(...)`, an alias
 * `const data = day.envelope.data`, and destructures of that object — and
 * checks accessed names against the entry's declared `fields`.
 *
 * Advisory only: it runs after validation, never rejects a program, and never
 * enters replay identity. Only `get` reads are checked; a `list` result's data
 * is an array whose element shape is exercised through callbacks this scan
 * does not follow.
 */
export function collectProgramFieldAdvisories(
  source: string,
  facade: readonly AgentProgramFacadeEntry[],
): readonly AgentProgramFieldAdvisory[] {
  const fieldsByNamespace = new Map<string, ReadonlySet<string>>();
  for (const entry of facade) {
    if (entry.fields && entry.fields.length > 0 && entry.verbs.includes("get")) {
      fieldsByNamespace.set(`${entry.package}.${entry.resource}`, new Set(entry.fields));
    }
  }
  if (fieldsByNamespace.size === 0) return [];
  let file: BabelNode;
  try {
    file = parse(wrap(source), PARSE_OPTIONS) as unknown as BabelNode;
  } catch {
    return []; // Validation owns syntax reporting; advisories need a parse.
  }

  const readVars = new Map<string, string>(); // identifier -> namespace of a `get` read
  const dataVars = new Map<string, string>(); // identifier -> namespace of an `envelope.data` alias
  const advisories: AgentProgramFieldAdvisory[] = [];
  const seen = new Set<string>();
  const check = (namespace: string, field: string) => {
    const fields = fieldsByNamespace.get(namespace);
    if (!fields || fields.has(field)) return;
    const key = `${namespace}:${field}`;
    if (seen.has(key)) return;
    seen.add(key);
    advisories.push({
      namespace,
      field,
      message: `\`${field}\` is not a field of ${namespace}; its fields are: ${[...fields].join(", ")}.`,
    });
  };

  /** Namespace of a checked facade `get` call: `athena.<pkg>.<res>.get(...)`, awaited or not. */
  const facadeGetNamespace = (node: BabelNode): string | undefined => {
    const expr = node.type === "AwaitExpression" ? (node.argument as BabelNode) : node;
    if (expr.type !== "CallExpression") return undefined;
    const chain = memberChain(expr.callee as BabelNode);
    if (!chain || (chain.root.name as string) !== "athena" || chain.segments.length !== 3) return undefined;
    const [pkg, resource, verb] = chain.segments;
    if (verb !== "get") return undefined;
    const namespace = `${pkg}.${resource}`;
    return fieldsByNamespace.has(namespace) ? namespace : undefined;
  };

  const checkPattern = (pattern: BabelNode, namespace: string) => {
    if (pattern.type !== "ObjectPattern") return;
    for (const property of pattern.properties as BabelNode[]) {
      if (property.type === "ObjectProperty" && property.computed !== true) {
        const key = property.key as BabelNode;
        if (key.type === "Identifier") check(namespace, key.name as string);
      }
    }
  };

  const visit = (node: BabelNode, parent: BabelNode | undefined, key: string) => {
    if (node.type === "VariableDeclarator" && isNode(node.init)) {
      const init = node.init as BabelNode;
      const id = node.id as BabelNode;
      const namespace = facadeGetNamespace(init);
      if (namespace && id.type === "Identifier") readVars.set(id.name as string, namespace);
      const chain = memberChain(init.type === "AwaitExpression" ? (init.argument as BabelNode) : init);
      if (chain) {
        const fromRead = readVars.get(chain.root.name as string);
        if (fromRead && chain.segments.length === 2 && chain.segments[0] === "envelope" && chain.segments[1] === "data") {
          if (id.type === "Identifier") dataVars.set(id.name as string, fromRead);
          else checkPattern(id, fromRead);
        }
        const fromData = dataVars.get(chain.root.name as string);
        if (fromData && chain.segments.length === 0) {
          if (id.type === "Identifier") dataVars.set(id.name as string, fromData);
          else checkPattern(id, fromData);
        }
      }
    }
    const parentIsChain = parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && key === "object";
    if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && !parentIsChain) {
      const chain = memberChain(node);
      if (chain) {
        const fromRead = readVars.get(chain.root.name as string);
        if (fromRead && chain.segments.length >= 3 && chain.segments[0] === "envelope" && chain.segments[1] === "data") {
          check(fromRead, chain.segments[2]);
        }
        const fromData = dataVars.get(chain.root.name as string);
        if (fromData && chain.segments.length >= 1) check(fromData, chain.segments[0]);
      }
    }
    for (const { key: childKey, child } of children(node)) visit(child, node, childKey);
  };
  visit(file, undefined, "root");
  return advisories;
}
