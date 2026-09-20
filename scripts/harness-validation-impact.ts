import { posix } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { OPERATOR_FULL_UNIT_CONTRACT } from "./harness-repo-validation";
import type {
  CanonicalValidationCheck,
  CanonicalValidationRegistry,
} from "./harness-app-registry";
import {
  ValidationPlanError,
  type ValidationChange,
} from "./harness-validation-plan";

/** Complete repository-relative source inventories supplied by the snapshot owner. No evidence is produced here. */
export type ValidationSnapshots = {
  base: Record<string, string>;
  candidate: Record<string, string>;
  /** Native-qualified symlink entry -> normalized immediate target, not source text. */
  links?: {
    base: Record<string, string>;
    candidate: Record<string, string>;
  };
};
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const contains = (prefix: string, path: string) =>
  prefix === "." || prefix === path || path.startsWith(`${prefix}/`);
type Graph = Map<string, Set<string>>;
const validPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.split("/").includes("..") &&
  !/[\x00-\x1f]/.test(value);
const paths = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(validPath);
export function validateImpactPolicy(
  registry: CanonicalValidationRegistry,
): void {
  const policy = registry.impact;
  if (policy === undefined) return;
  const malformed = (message: string): never => {
    throw new ValidationPlanError("malformed-map", message);
  };
  if (
    !policy ||
    !Array.isArray(policy.packages) ||
    !policy.packages.length ||
    !Array.isArray(policy.relationships)
  )
    malformed("Invalid impact policy.");
  const checks = new Map(registry.checks.map((check) => [check.id, check]));
  const roots = new Set<string>(),
    units = new Set<string>(),
    relationshipIds = new Set<string>();
  for (const pkg of policy.packages) {
    if (
      !pkg ||
      !validPath(pkg.root) ||
      roots.has(pkg.root) ||
      !paths(pkg.testPatterns) ||
      !paths(pkg.unitChecks) ||
      !paths(pkg.fallbackChecks) ||
      !pkg.fallbackChecks.length ||
      [...pkg.unitChecks, ...pkg.fallbackChecks].some((id) => !checks.has(id))
    )
      malformed("Invalid package fallback declaration.");
    roots.add(pkg.root);
    for (const id of pkg.unitChecks) {
      if (
        units.has(id) ||
        checks.get(id)!.cwd !== pkg.root ||
        !checks.get(id)!.profile.endsWith(":unit") ||
        !pkg.testPatterns.length
      )
        malformed("Invalid unit membership declaration.");
      units.add(id);
    }
    if (pkg.testPatterns.some((pattern) => !contains(pkg.root, pattern)))
      malformed("Test membership escapes its declared package.");
  }
  for (const relation of policy.relationships) {
    if (
      !relation ||
      typeof relation.id !== "string" ||
      !relation.id ||
      (relation.kind !== undefined && relation.kind !== "data") ||
      relationshipIds.has(relation.id) ||
      !paths(relation.inputs) ||
      !relation.inputs.length ||
      !paths(relation.consumers) ||
      (!relation.consumers.length &&
        !relation.checks?.length &&
        !relation.publishingChecks?.length)
    )
      malformed("Invalid runtime relationship.");
    relationshipIds.add(relation.id);
    if (
      relation.lazyProducers !== undefined &&
      (relation.kind !== "data" ||
        !relation.lazyProducers ||
        typeof relation.lazyProducers !== "object" ||
        Array.isArray(relation.lazyProducers) ||
        Object.entries(relation.lazyProducers).some(
          ([path, digest]) =>
            !validPath(path) ||
            typeof digest !== "string" ||
            !/^[0-9a-f]{64}$/.test(digest),
        ))
    )
      malformed("Invalid lazy data producer qualification.");
    if (
      relation.guards !== undefined &&
      (!relation.guards ||
        typeof relation.guards !== "object" ||
        Array.isArray(relation.guards) ||
        Object.entries(relation.guards).some(
          ([path, digest]) =>
            !validPath(path) ||
            typeof digest !== "string" ||
            !/^[0-9a-f]{64}$/.test(digest),
        ))
    )
      malformed("Invalid runtime contract guards.");
    for (const targets of [relation.checks, relation.publishingChecks])
      if (
        targets !== undefined &&
        (!paths(targets) ||
          !targets.length ||
          targets.some((id) => !checks.has(id)))
      )
        malformed("Invalid runtime or publishing check declaration.");
    if (
      relation.boundedConsumers !== undefined &&
      (!relation.boundedConsumers ||
        typeof relation.boundedConsumers !== "object" ||
        Array.isArray(relation.boundedConsumers) ||
        Object.entries(relation.boundedConsumers).some(
          ([path, digest]) =>
            !validPath(path) ||
            !relation.consumers.some((prefix) => contains(prefix, path)) ||
            typeof digest !== "string" ||
            !/^[0-9a-f]{64}$/.test(digest),
        ))
    )
      malformed("Invalid bounded runtime consumer qualification.");
  }
}
function validateSnapshots(snapshots: ValidationSnapshots) {
  if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots))
    throw new ValidationPlanError("malformed-map", "Invalid snapshots.");
  for (const files of [snapshots.base, snapshots.candidate]) {
    if (
      !files ||
      typeof files !== "object" ||
      Array.isArray(files) ||
      Object.entries(files).some(
        ([path, text]) => !validPath(path) || typeof text !== "string",
      )
    )
      throw new ValidationPlanError(
        "malformed-map",
        "Invalid snapshot: expected repository-relative paths and source text values.",
      );
  }
  if (snapshots.links !== undefined) {
    if (
      !snapshots.links ||
      typeof snapshots.links !== "object" ||
      Array.isArray(snapshots.links)
    )
      throw new ValidationPlanError("malformed-map", "Invalid snapshot links.");
    for (const side of ["base", "candidate"] as const) {
      if (
        !snapshots.links[side] ||
        typeof snapshots.links[side] !== "object" ||
        Array.isArray(snapshots.links[side])
      )
        throw new ValidationPlanError(
          "malformed-map",
          "Invalid snapshot link map.",
        );
      sourcePaths(snapshots[side], snapshots.links[side]);
    }
  }
}

/** Resolves only the pinned inventory. No ambient filesystem lookup is allowed. */
function sourcePaths(
  files: Record<string, string>,
  links: Record<string, string> = {},
) {
  const malformed = (message: string): never => {
    throw new ValidationPlanError("malformed-map", message);
  };
  if (!links || typeof links !== "object" || Array.isArray(links))
    malformed("Invalid snapshot link map.");
  const names = Object.keys(links).sort((a, b) => b.length - a.length);
  for (const [path, target] of Object.entries(links)) {
    if (
      !validPath(path) ||
      path === "." ||
      posix.normalize(path) !== path ||
      !Object.hasOwn(files, path) ||
      !validPath(target) ||
      posix.normalize(target) !== target
    )
      malformed("Invalid snapshot link entry or target.");
    if (Object.keys(files).some((file) => file.startsWith(`${path}/`)))
      malformed(`Snapshot inventories descendants beneath a link: ${path}`);
  }
  const resolve = (path: string) => {
    const crossed: string[] = [];
    let physical = path;
    for (;;) {
      const link = names.find((name) => contains(name, physical));
      if (!link) return { physical, crossed };
      if (crossed.includes(link)) malformed(`Cyclic snapshot link: ${link}`);
      crossed.push(link);
      physical = posix.join(links[link], physical.slice(link.length));
      if (!validPath(physical))
        malformed(`Snapshot link escapes inventory: ${link}`);
    }
  };
  const exists = (path: string) =>
    Object.hasOwn(files, path) ||
    Object.keys(files).some((file) => contains(path, file));
  for (const name of names) {
    const target = resolve(name).physical;
    if (!exists(target)) malformed(`Dangling snapshot link: ${name}`);
  }
  return { resolve, names };
}
const connect = (graph: Graph, from: string, to: string) => {
  const targets = graph.get(from) ?? new Set<string>();
  targets.add(to);
  graph.set(from, targets);
};
function dependencies(
  files: Record<string, string>,
  links: Record<string, string> = {},
): {
  graph: Graph;
  data: Graph;
  unknown: Map<string, Map<string, string[] | null>>;
} {
  const graph: Graph = new Map();
  const data: Graph = new Map();
  const linkPaths = sourcePaths(files, links);
  // Preserve every real link entry in forward input and reverse impact closure.
  // Source is parsed only at its physical path below.
  for (const link of linkPaths.names) {
    const { physical, crossed } = linkPaths.resolve(link);
    for (const input of crossed.slice(1)) connect(graph, link, input);
    if (Object.hasOwn(files, physical)) connect(graph, link, physical);
  }
  const unknown = new Map<string, Map<string, string[] | null>>();
  const mark = (
    file: string,
    reason: string,
    scope: string[] | null = null,
  ) => {
    const reasons = unknown.get(file) ?? new Map<string, string[] | null>();
    const previous = reasons.get(reason);
    reasons.set(
      reason,
      previous === null || scope === null
        ? null
        : sorted([...(previous ?? []), ...scope]),
    );
    unknown.set(file, reasons);
  };
  const manifests = new Map<
    string,
    {
      name?: string;
      exports?: unknown;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    }
  >();
  for (const [path, text] of Object.entries(files))
    if (posix.basename(path) === "package.json") {
      try {
        const manifest = JSON.parse(
          Object.hasOwn(links, path)
            ? files[linkPaths.resolve(path).physical]
            : text,
        );
        if (
          !manifest ||
          typeof manifest !== "object" ||
          Array.isArray(manifest)
        )
          throw new Error();
        manifests.set(posix.dirname(path), manifest);
      } catch {
        throw new ValidationPlanError(
          "malformed-map",
          `Malformed snapshot package manifest: ${path}`,
        );
      }
    }
  const packageRoot = (file: string) =>
    [...manifests.keys()]
      .filter((root) => root === "." || contains(root, file))
      .sort((a, b) => b.length - a.length)[0];
  const linkedConfigurations = new Map<string, string[]>();
  const configurationLinks = (root: string) => {
    if (!linkedConfigurations.has(root)) {
      const inputs = configurationInputs(files, root).flatMap(
        (configuration) => {
          const { physical, crossed } = linkPaths.resolve(configuration);
          return crossed.length
            ? [
                ...crossed,
                ...(Object.hasOwn(files, physical) ? [physical] : []),
              ]
            : [];
        },
      );
      linkedConfigurations.set(root, sorted(inputs));
    }
    return linkedConfigurations.get(root)!;
  };
  const findFile = (path: string, consumer?: string, typeOnly = false) => {
    const withoutJs = /\.[cm]?jsx?$/.test(path)
      ? path.replace(/\.[cm]?jsx?$/, "")
      : path;
    for (const candidate of [
      path,
      ...[
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".d.ts",
        ".json",
        "/index.ts",
        "/index.tsx",
        "/index.js",
      ].map((suffix) => `${withoutJs}${suffix}`),
    ]) {
      const { physical, crossed } = linkPaths.resolve(candidate);
      if (!Object.hasOwn(files, physical) || Object.hasOwn(links, physical))
        continue;
      if (consumer)
        for (const link of crossed)
          connect(typeOnly ? data : graph, consumer, link);
      return physical;
    }
    return undefined;
  };
  for (const [file, text] of Object.entries(files)) {
    if (Object.hasOwn(links, file)) continue;
    if (/\.(?:vue|svelte|astro|mdx)$/.test(file))
      mark(file, "unqualified-source-loader");
    if (/\.(?:css|scss|sass|less)$/.test(file))
      mark(file, "unqualified-style-dependencies");
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    if (
      (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
        .parseDiagnostics.length
    )
      mark(file, "unparsed-source");
    const root = packageRoot(file);
    for (const input of configurationLinks(root ?? "."))
      connect(graph, file, input);
    const apiNames = new Set<string>();
    const convexFactories = new Set<string>();
    for (const statement of source.statements)
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const binding of bindings.elements) {
            const imported = binding.propertyName?.text ?? binding.name.text;
            if (
              /\/_generated\/api$/.test(statement.moduleSpecifier.text) &&
              ["api", "internal"].includes(imported)
            )
              apiNames.add(binding.name.text);
            if (
              statement.moduleSpecifier.text === "convex-test" &&
              imported === "convexTest"
            )
              convexFactories.add(binding.name.text);
          }
      }
    const isGlob = (node: ts.Node): node is ts.CallExpression =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "glob" &&
      ts.isMetaProperty(node.expression.expression) &&
      node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
    const lazyRegistries = new Set<ts.CallExpression>();
    const nodes: ts.Node[] = [];
    const gather = (node: ts.Node) => {
      nodes.push(node);
      ts.forEachChild(node, gather);
    };
    gather(source);
    // Name matching is qualified only when no lexical binding can shadow an
    // imported Convex factory or API. Unsupported scopes retain backend coverage.
    const bindingNames = (name: ts.BindingName): string[] =>
      ts.isIdentifier(name)
        ? [name.text]
        : name.elements.flatMap((element) =>
            ts.isBindingElement(element) ? bindingNames(element.name) : [],
          );
    const shadowedConvexImport = nodes.some((node) => {
      const names =
        ts.isVariableDeclaration(node) || ts.isParameter(node)
          ? bindingNames(node.name)
          : (ts.isFunctionDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isFunctionExpression(node) ||
                ts.isClassExpression(node)) &&
              node.name
            ? [node.name.text]
            : [];
      return names.some(
        (name) => convexFactories.has(name) || apiNames.has(name),
      );
    });
    if (shadowedConvexImport)
      mark(
        file,
        "unqualified-convex-binding",
        root ? [posix.join(root, "convex")] : null,
      );
    const convexContexts = new Set<string>();
    for (const node of nodes)
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        convexFactories.has(node.initializer.expression.text)
      )
        convexContexts.add(node.name.text);
    for (const node of nodes)
      if (
        isGlob(node) &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name)
      ) {
        const declaration = node.parent;
        const name = (declaration.name as ts.Identifier).text;
        const uses = nodes.filter(
          (entry) =>
            ts.isIdentifier(entry) &&
            entry.text === name &&
            entry !== declaration.name,
        );
        if (
          !shadowedConvexImport &&
          uses.length > 0 &&
          uses.every(
            (entry) =>
              ts.isCallExpression(entry.parent) &&
              ts.isIdentifier(entry.parent.expression) &&
              convexFactories.has(entry.parent.expression.text) &&
              entry.parent.arguments[1] === entry,
          ) &&
          apiNames.size
        )
          lazyRegistries.add(node);
      }
    const literalReference = (node: ts.Expression): string[] | null => {
      if (ts.isIdentifier(node))
        return apiNames.has(node.text) ? [node.text] : null;
      if (ts.isPropertyAccessExpression(node)) {
        const parent = literalReference(node.expression);
        return parent && [...parent, node.name.text];
      }
      if (ts.isElementAccessExpression(node)) {
        const parent = literalReference(node.expression);
        return parent && ts.isStringLiteral(node.argumentExpression)
          ? [...parent, node.argumentExpression.text]
          : null;
      }
      return null;
    };
    let resolvedApi = false;
    const resolve = (
      specifier: string,
      apiImport = false,
      typeOnly = false,
    ) => {
      let target: string | undefined;
      let workspaceMatches = 0;
      let local = false;
      const clean = specifier.replace(/\?(raw|url)$/, "");
      if (clean.startsWith(".")) {
        const path = posix.normalize(posix.join(posix.dirname(file), clean));
        if (path.split("/").includes("node_modules")) return;
        local = true;
        target = findFile(path, file, typeOnly);
      } else {
        const configPath = root && posix.join(root, "tsconfig.json");
        if (configPath && Object.hasOwn(files, configPath)) {
          const parsed = ts.parseConfigFileTextToJson(
            configPath,
            files[linkPaths.resolve(configPath).physical],
          );
          if (
            parsed.error ||
            !parsed.config ||
            typeof parsed.config !== "object"
          )
            throw new ValidationPlanError(
              "malformed-map",
              `Malformed snapshot tsconfig: ${configPath}`,
            );
          if (parsed.config.extends) mark(file, "unqualified-tsconfig-extends");
          const options = parsed.config.compilerOptions ?? {};
          if (
            !options ||
            typeof options !== "object" ||
            Array.isArray(options) ||
            (options.baseUrl !== undefined &&
              typeof options.baseUrl !== "string") ||
            (options.paths !== undefined &&
              (!options.paths ||
                typeof options.paths !== "object" ||
                Array.isArray(options.paths)))
          )
            throw new ValidationPlanError(
              "malformed-map",
              `Malformed snapshot compiler options: ${configPath}`,
            );
          for (const [alias, replacements] of Object.entries(
            options.paths ?? {},
          )) {
            if (
              !Array.isArray(replacements) ||
              replacements.some((entry) => typeof entry !== "string")
            )
              throw new ValidationPlanError(
                "malformed-map",
                `Malformed snapshot alias: ${configPath}`,
              );
            const [prefix, suffix = ""] = alias.split("*");
            const matches = alias.includes("*")
              ? clean.startsWith(prefix) && clean.endsWith(suffix)
              : alias === clean;
            if (matches)
              for (const replacement of replacements) {
                local = true;
                const middle = alias.includes("*")
                  ? clean.slice(prefix.length, clean.length - suffix.length)
                  : "";
                target ??= findFile(
                  posix.normalize(
                    posix.join(
                      root!,
                      options.baseUrl ?? ".",
                      replacement.replace("*", middle),
                    ),
                  ),
                  file,
                  typeOnly,
                );
              }
          }
          if (!target && options.baseUrl !== undefined) {
            target = findFile(
              posix.join(root!, options.baseUrl, clean),
              file,
              typeOnly,
            );
            if (target) local = true;
          }
        }
        for (const [workspace, manifest] of manifests)
          if (
            manifest.name &&
            (clean === manifest.name || clean.startsWith(`${manifest.name}/`))
          ) {
            if (++workspaceMatches > 1)
              mark(file, "ambiguous-workspace-export");
            local = true;
            const subpath =
              clean === manifest.name
                ? "."
                : `.${clean.slice(manifest.name.length)}`;
            const exported =
              typeof manifest.exports === "string" && subpath === "."
                ? manifest.exports
                : manifest.exports && typeof manifest.exports === "object"
                  ? (manifest.exports as Record<string, unknown>)[subpath]
                  : undefined;
            if (typeof exported === "string" && exported.startsWith("./"))
              target ??= findFile(
                posix.join(workspace, exported),
                file,
                typeOnly,
              );
            else mark(file, "unqualified-workspace-export");
          }
      }
      if (target) {
        if (
          apiImport &&
          root &&
          [
            `${root}/convex/_generated/api.ts`,
            `${root}/convex/_generated/api.js`,
            `${root}/convex/_generated/api.d.ts`,
          ].includes(target)
        )
          return;
        if (apiImport) mark(file, "unqualified-convex-reference");
        connect(typeOnly ? data : graph, file, target);
        return;
      }
      if (apiImport) mark(file, "unqualified-convex-reference");
      if (!typeOnly && clean === "bun") {
        mark(file, "filesystem-or-process-dependency");
        mark(file, "process-or-module-dependency");
        return;
      }
      const packageName = clean.startsWith("@")
        ? clean.split("/").slice(0, 2).join("/")
        : clean.split("/")[0];
      const knownExternal = [
        manifests.get(root ?? "."),
        manifests.get("."),
      ].some(
        (manifest) =>
          manifest?.dependencies?.[packageName] ||
          manifest?.devDependencies?.[packageName],
      );
      if (
        clean.startsWith("node:") ||
        [
          "fs",
          "fs/promises",
          "path",
          "url",
          "module",
          "child_process",
          "os",
          "crypto",
          "util",
          "events",
          "stream",
          "assert",
          "buffer",
        ].includes(clean)
      ) {
        if (!typeOnly && /^(?:node:)?fs(?:\/|$)/.test(clean))
          mark(file, "filesystem-or-process-dependency");
        if (
          !typeOnly &&
          /^(?:node:)?(?:child_process|module)(?:\/|$)/.test(clean)
        )
          mark(file, "process-or-module-dependency");
        return;
      }
      // Static bare package imports are external dependency inputs; local aliases and
      // workspace exports must resolve above and cannot escape into this branch.
      if (
        !local &&
        !clean.startsWith("/") &&
        (knownExternal || /^(?:@[^/]+\/)?[a-zA-Z0-9_-][^?]*$/.test(clean))
      )
        return;
      mark(file, "unresolved-import");
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        [
          "setupFiles",
          "setupFilesAfterEnv",
          "globalSetup",
          "globalTeardown",
        ].includes(node.name.text)
      ) {
        const values = ts.isArrayLiteralExpression(node.initializer)
          ? node.initializer.elements
          : [node.initializer];
        for (const value of values) {
          if (ts.isStringLiteral(value))
            resolve(
              value.text.startsWith(".") ? value.text : `./${value.text}`,
            );
          else mark(file, "unqualified-runner-configuration");
        }
      }
      if (ts.isIdentifier(node) && node.text === "Bun") {
        const parent = node.parent;
        const member =
          ts.isPropertyAccessExpression(parent) && parent.expression === node
            ? parent.name.text
            : ts.isElementAccessExpression(parent) &&
                parent.expression === node &&
                ts.isStringLiteral(parent.argumentExpression)
              ? parent.argumentExpression.text
              : undefined;
        if (member === undefined || ["file", "write", "Glob"].includes(member))
          mark(file, "filesystem-or-process-dependency");
        if (
          member === undefined ||
          ["spawn", "spawnSync", "$"].includes(member)
        )
          mark(file, "process-or-module-dependency");
      }
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        resolve(
          node.moduleSpecifier.text,
          /\/_generated\/api$/.test(node.moduleSpecifier.text) &&
            apiNames.size > 0,
          ts.isImportDeclaration(node)
            ? Boolean(
                node.importClause?.isTypeOnly ||
                (!node.importClause?.name &&
                  node.importClause?.namedBindings &&
                  ts.isNamedImports(node.importClause.namedBindings) &&
                  node.importClause.namedBindings.elements.length &&
                  node.importClause.namedBindings.elements.every(
                    (element) => element.isTypeOnly,
                  )),
              )
            : node.isTypeOnly,
        );
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        convexContexts.has(node.expression.expression.text)
      ) {
        if (
          !["query", "mutation", "action"].includes(
            node.expression.name.text,
          ) ||
          !node.arguments[0] ||
          !literalReference(node.arguments[0])
        )
          mark(
            file,
            "unqualified-convex-call",
            root ? [`${root}/convex`] : null,
          );
      }
      if (ts.isIdentifier(node) && apiNames.has(node.text)) {
        if (
          !ts.isImportSpecifier(node.parent) &&
          !(
            ts.isPropertyAccessExpression(node.parent) &&
            node.parent.expression === node
          ) &&
          !(
            ts.isElementAccessExpression(node.parent) &&
            node.parent.expression === node
          )
        )
          mark(
            file,
            "unqualified-convex-reference",
            root ? [`${root}/convex`] : null,
          );
      }
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        !(
          (ts.isPropertyAccessExpression(node.parent) ||
            ts.isElementAccessExpression(node.parent)) &&
          node.parent.expression === node
        )
      ) {
        let head: ts.Expression = node;
        while (
          ts.isPropertyAccessExpression(head) ||
          ts.isElementAccessExpression(head)
        )
          head = head.expression;
        if (ts.isIdentifier(head) && apiNames.has(head.text)) {
          const reference = literalReference(node);
          const target =
            reference && reference.length >= 3 && root
              ? findFile(
                  `${root}/convex/${reference.slice(1, -1).join("/")}`,
                  file,
                )
              : undefined;
          if (target) {
            connect(graph, file, target);
            resolvedApi = true;
          } else
            mark(
              file,
              "unqualified-convex-reference",
              root ? [`${root}/convex`] : null,
            );
        }
      }
      if (isGlob(node)) {
        if (convexFactories.size) {
          if (!lazyRegistries.has(node))
            mark(
              file,
              "unqualified-convex-registry",
              root ? [`${root}/convex`] : null,
            );
        } else if (
          node.arguments.length >= 1 &&
          node.arguments.length <= 2 &&
          ts.isStringLiteral(node.arguments[0]) &&
          node.arguments[0].text.startsWith(".") &&
          (node.arguments.length === 1 ||
            (ts.isObjectLiteralExpression(node.arguments[1]) &&
              node.arguments[1].properties.every(
                (property) =>
                  ts.isPropertyAssignment(property) &&
                  [
                    ts.SyntaxKind.StringLiteral,
                    ts.SyntaxKind.TrueKeyword,
                    ts.SyntaxKind.FalseKeyword,
                  ].includes(property.initializer.kind),
              )))
        ) {
          const pattern = posix.normalize(
            posix.join(posix.dirname(file), node.arguments[0].text),
          );
          const glob = new Bun.Glob(pattern);
          const firstMagic = pattern.search(/[\*?\[\]{]/);
          const beforeMagic = pattern.slice(0, firstMagic);
          const literalPrefix =
            firstMagic < 0
              ? pattern
              : beforeMagic.endsWith("/")
                ? beforeMagic.slice(0, -1)
                : posix.dirname(beforeMagic);
          const linkedDirectories = linkPaths.names.filter(
            (link) =>
              !Object.hasOwn(files, linkPaths.resolve(link).physical) &&
              (contains(link, literalPrefix) ||
                contains(literalPrefix || ".", link)),
          );
          if (linkedDirectories.length) {
            // Directory-glob expansion is runner-defined. Keep the named containing
            // fallback instead of interpreting an empty virtual directory as no work.
            mark(file, "unqualified-linked-glob");
          }
          for (const target of Object.keys(files))
            if (glob.match(target)) connect(graph, file, target);
        } else mark(file, "unqualified-glob");
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        if (
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0])
        )
          resolve(node.arguments[0].text);
        else mark(file, "computed-import");
      }
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        resolve(node.argument.literal.text, false, true);
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "URL" &&
        node.arguments?.length === 2 &&
        node.arguments[1].getText(source) === "import.meta.url"
      ) {
        if (
          ts.isStringLiteral(node.arguments[0]) &&
          node.arguments[0].text.startsWith(".")
        ) {
          const path = posix.normalize(
            posix.join(posix.dirname(file), node.arguments[0].text),
          );
          const descendants = Object.keys(files).filter(
            (target) =>
              target !== path && contains(path.replace(/\/$/, ""), target),
          );
          if (descendants.length) mark(file, "directory-url");
          else resolve(node.arguments[0].text);
        } else mark(file, "computed-asset-url");
      }
      if (
        (ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          ["eval", "Function"].includes(node.expression.text)) ||
        (ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "Function")
      )
        mark(file, "dynamic-code-dependencies");
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (lazyRegistries.size && !resolvedApi)
      mark(
        file,
        "unqualified-convex-registry",
        root ? [`${root}/convex`] : null,
      );
  }
  return { graph, data, unknown };
}
function closure(graph: Graph, seeds: Iterable<string>): Set<string> {
  const found = new Set(seeds),
    queue = [...found];
  for (let i = 0; i < queue.length; i++) {
    for (const target of graph.get(queue[i]) ?? []) {
      if (!found.has(target)) {
        found.add(target);
        queue.push(target);
      }
    }
  }
  return found;
}
function configurationInputs(
  files: Record<string, string>,
  root: string,
): string[] {
  return Object.keys(files).filter(
    (file) =>
      [".", root].includes(posix.dirname(file)) &&
      /^(?:package\.json|tsconfig(?:\.[^.]+)?\.json|bun(?:\.lockb|\.lock|fig\.toml)|(?:vite|vitest|postcss|tailwind|eslint|biome)[^/]*\.[^/]+)$/.test(
        posix.basename(file),
      ),
  );
}

function bindInputs(
  check: CanonicalValidationCheck,
  registry: CanonicalValidationRegistry,
  snapshots: ValidationSnapshots,
  graph: Graph,
  membership: string[],
  changed: string[],
  broad: boolean,
  uncertainScopes: string[] = [],
  baseGraph: Graph = graph,
  dataGraphs: Graph[] = [],
): CanonicalValidationCheck {
  const owner =
    registry
      .impact!.packages.filter(
        (pkg) => pkg.root !== "." && check.profile.startsWith(`${pkg.root}:`),
      )
      .sort((a, b) => b.root.length - a.root.length)[0]?.root ?? check.cwd;
  const owned = broad
    ? sorted([
        ...Object.keys(snapshots.base),
        ...Object.keys(snapshots.candidate),
      ]).filter((path) => contains(owner, path))
    : [];
  const configuration = configurationInputs(snapshots.candidate, owner);
  const typeOnly = check.profile.endsWith(":package-types");
  const seeds = [
    ...membership,
    ...owned,
    ...configuration,
    ...changed.filter(
      (path) =>
        contains(owner, path) && !Object.hasOwn(snapshots.candidate, path),
    ),
    ...Object.keys(snapshots.candidate).filter((path) =>
      uncertainScopes.some((prefix) => contains(prefix, path)),
    ),
  ];
  const executableInputs = sorted([
    ...closure(graph, seeds),
    ...closure(baseGraph, seeds),
  ]);
  if (typeOnly) {
    const all: Graph = new Map();
    for (const source of [graph, baseGraph, ...dataGraphs])
      for (const [file, targets] of source)
        for (const target of targets) connect(all, file, target);
    executableInputs.push(...closure(all, executableInputs));
  }
  const inputs = sorted([
    ...check.inputs,
    ...check.absentInputs,
    ...executableInputs,
    ...dataGraphs.flatMap((data) =>
      executableInputs.flatMap((path) => [...(data.get(path) ?? [])]),
    ),
  ]).filter(
    (path) =>
      !typeOnly ||
      /\.[cm]?[jt]sx?$|\.json$/.test(path) ||
      configuration.includes(path) ||
      check.inputs.includes(path),
  );
  return {
    ...check,
    membership,
    inputs: inputs.filter((path) => Object.hasOwn(snapshots.candidate, path)),
    absentInputs: inputs.filter(
      (path) => !Object.hasOwn(snapshots.candidate, path),
    ),
  };
}

/** Project conservative consumer selection into the existing canonical registry. */
function resolveConsumerImpact(
  registry: CanonicalValidationRegistry,
  changes: ValidationChange[],
  snapshots: ValidationSnapshots,
  fullHealth = false,
): CanonicalValidationRegistry {
  if (!registry.impact)
    throw new ValidationPlanError(
      "malformed-map",
      "Affected planning requires declared impact policy.",
    );
  validateSnapshots(snapshots);
  const ids = new Set(registry.checks.map((check) => check.id));
  for (const pkg of registry.impact.packages) {
    if (
      !pkg.root ||
      !pkg.fallbackChecks.length ||
      [...pkg.unitChecks, ...pkg.fallbackChecks].some((id) => !ids.has(id))
    )
      throw new ValidationPlanError(
        "malformed-map",
        "Invalid package fallback declaration.",
      );
  }
  const changed = sorted(
    changes.flatMap((change) => [
      change.path,
      ...(change.oldPath ? [change.oldPath] : []),
    ]),
  );
  const declared = new Set(changed);
  for (const path of sorted([
    ...Object.keys(snapshots.base),
    ...Object.keys(snapshots.candidate),
  ]))
    if (
      !fullHealth &&
      snapshots.base[path] !== snapshots.candidate[path] &&
      !declared.has(path)
    )
      throw new ValidationPlanError(
        "uncovered-input",
        `Snapshot contains undeclared changed input: ${path}`,
      );
  for (const path of changed)
    if (
      !Object.hasOwn(snapshots.base, path) &&
      !Object.hasOwn(snapshots.candidate, path)
    )
      throw new ValidationPlanError(
        "uncovered-input",
        `Changed input is missing from both snapshots: ${path}`,
      );
  for (const change of changes) {
    const before = Object.hasOwn(snapshots.base, change.path),
      after = Object.hasOwn(snapshots.candidate, change.path);
    const valid =
      change.status === "added"
        ? !before && after
        : change.status === "deleted"
          ? before && !after
          : change.status === "modified"
            ? before && after
            : change.oldPath !== change.path &&
              Object.hasOwn(snapshots.base, change.oldPath!) &&
              !Object.hasOwn(snapshots.candidate, change.oldPath!) &&
              after;
    if (!valid)
      throw new ValidationPlanError(
        "malformed-map",
        `Semantic status disagrees with snapshots: ${change.status} ${change.path}`,
      );
  }
  const publishing = registry.impact.relationships.filter(
    (contract) => contract.publishingChecks,
  );
  const baseAnalysis = dependencies(snapshots.base, snapshots.links?.base),
    candidateAnalysis = dependencies(
      snapshots.candidate,
      snapshots.links?.candidate,
    );
  const baseGraph = baseAnalysis.graph,
    candidateGraph = candidateAnalysis.graph;
  const baseData = baseAnalysis.data,
    candidateData = candidateAnalysis.data;
  const guardsMatch = (
    guards: Record<string, string> | undefined,
    files: Record<string, string>,
  ) =>
    Object.entries(guards ?? {}).every(
      ([path, digest]) =>
        Object.hasOwn(files, path) &&
        createHash("sha256").update(files[path]).digest("hex") === digest,
    );
  const contractReasons: string[] = [];
  for (const relationship of registry.impact.relationships) {
    if (
      !relationship.id ||
      !relationship.inputs.length ||
      (!relationship.consumers.length &&
        !relationship.checks?.length &&
        !relationship.publishingChecks?.length) ||
      relationship.checks?.some((id) => !ids.has(id))
    )
      throw new ValidationPlanError(
        "malformed-map",
        "Invalid runtime relationship.",
      );
    for (const [files, graph, data] of [
      [snapshots.base, baseGraph, baseData],
      [snapshots.candidate, candidateGraph, candidateData],
    ] as const) {
      if (!guardsMatch(relationship.guards, files)) continue;
      if (!guardsMatch(relationship.lazyProducers, files)) continue;
      const consumers = Object.keys(files).filter(
        (path) =>
          relationship.consumers.some((prefix) => contains(prefix, path)) &&
          (!relationship.boundedConsumers?.[path] ||
            relationship.boundedConsumers[path] ===
              createHash("sha256").update(files[path]).digest("hex")),
      );
      for (const consumer of consumers)
        for (const producer of Object.keys(relationship.lazyProducers ?? {}))
          connect(graph, consumer, producer);
      for (const input of Object.keys(files).filter((path) =>
        relationship.inputs.some((prefix) => contains(prefix, path)),
      ))
        for (const consumer of consumers)
          connect(relationship.kind === "data" ? data : graph, consumer, input);
    }
    if (
      changes.some((change) =>
        relationship.inputs.some(
          (prefix) =>
            contains(prefix, change.path) ||
            (change.oldPath && contains(prefix, change.oldPath)),
        ),
      )
    )
      contractReasons.push(relationship.id);
  }
  const reverse: Graph = new Map();
  if (fullHealth)
    return {
      ...registry,
      checks: registry.checks.map((check) => {
        const pkg = registry.impact!.packages.find((pkg) =>
          pkg.unitChecks.includes(check.id),
        );
        const membership = pkg
          ? Object.keys(snapshots.candidate)
              .filter((path) =>
                pkg.testPatterns.some((pattern) =>
                  new Bun.Glob(pattern).match(path),
                ),
              )
              .sort()
          : check.membership;
        return bindInputs(
          check,
          registry,
          snapshots,
          candidateGraph,
          membership,
          changed,
          true,
          [],
          baseGraph,
          [baseData, candidateData],
        );
      }),
    };
  for (const graph of [baseGraph, candidateGraph])
    for (const [consumer, inputs] of graph)
      for (const input of inputs) connect(reverse, input, consumer);
  const dataConsumers = (paths: Iterable<string>) => {
    const inputs = new Set(paths);
    return [baseData, candidateData].flatMap((data) =>
      [...data]
        .filter(([, reads]) => [...reads].some((path) => inputs.has(path)))
        .map(([reader]) => reader),
    );
  };
  const affected = closure(reverse, [...changed, ...dataConsumers(changed)]);
  const selected = new Set(registry.alwaysRequired);
  for (const relationship of registry.impact.relationships)
    if (contractReasons.includes(relationship.id)) {
      relationship.checks?.forEach((id) => selected.add(id));
      relationship.publishingChecks?.forEach((id) => selected.add(id));
    }
  const reasons: string[] = [...contractReasons];
  for (const surface of registry.surfaces)
    if (
      surface.pathPrefixes.some((prefix) =>
        [...affected].some((path) => contains(prefix, path)),
      )
    ) {
      surface.checks.forEach((id) => selected.add(id));
      reasons.push(surface.reason);
    }
  for (const path of changed) {
    const consumers = closure(reverse, [path, ...dataConsumers([path])]);
    if (
      !registry.surfaces.some((surface) =>
        surface.pathPrefixes.some((prefix) =>
          [...consumers].some((consumer) => contains(prefix, consumer)),
        ),
      )
    )
      throw new ValidationPlanError(
        "uncovered-input",
        `No containing obligation covers input: ${path}`,
      );
  }
  const unitChecks = new Set(
    registry.impact.packages.flatMap((pkg) => pkg.unitChecks),
  );
  const fallbackChecks = new Set<string>();
  const uncertainInputs = new Map<string, Set<string>>();
  const uncertainMemberInputs = new Map<string, Set<string>>();
  const selectUncertain = (
    ids: string[],
    scopes: string[],
    fullMembership = false,
  ) => {
    for (const id of ids) {
      selected.add(id);
      if (fullMembership) fallbackChecks.add(id);
      const inputs = uncertainInputs.get(id) ?? new Set<string>();
      scopes.forEach((scope) => inputs.add(scope));
      uncertainInputs.set(id, inputs);
    }
  };
  const candidateTests = new Set(
    Object.keys(snapshots.candidate).filter((path) =>
      registry.impact!.packages.some((pkg) =>
        pkg.testPatterns.some((pattern) => new Bun.Glob(pattern).match(path)),
      ),
    ),
  );
  const runnerInputs = new Map<string, Set<string>>();
  for (const pkg of registry.impact.packages) {
    const configRoots = sorted([
      ...configurationInputs(snapshots.base, pkg.root),
      ...configurationInputs(snapshots.candidate, pkg.root),
    ]);
    const configDependencies = new Set([
      ...closure(baseGraph, configRoots),
      ...closure(candidateGraph, configRoots),
    ]);
    runnerInputs.set(pkg.root, configDependencies);
    if (changed.some((path) => configDependencies.has(path))) {
      selectUncertain(pkg.fallbackChecks, [pkg.root], true);
      reasons.push(`Fallback ${pkg.root}: runner-configuration`);
    }
  }
  for (const path of changed) {
    if (
      publishing.some((contract) =>
        contract.inputs.some((prefix) => contains(prefix, path)),
      )
    )
      continue;
    if (
      [...closure(reverse, [path, ...dataConsumers([path])])].some((consumer) =>
        candidateTests.has(consumer),
      )
    )
      continue;
    const pkg = registry.impact.packages
      .filter((pkg) => contains(pkg.root, path))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (!pkg)
      throw new ValidationPlanError(
        "uncovered-input",
        `No proven containing suite for source without resolved test consumers: ${path}`,
      );
    selectUncertain(pkg.fallbackChecks, ["."], true);
    reasons.push(`Fallback ${pkg.root}: unresolved-test-consumers (${path})`);
  }
  for (const path of changed)
    if (!Object.hasOwn(snapshots.candidate, path)) {
      for (const pkg of registry.impact.packages)
        if (
          pkg.testPatterns.some((pattern) => new Bun.Glob(pattern).match(path))
        ) {
          selectUncertain(pkg.fallbackChecks, [pkg.root], true);
          reasons.push(`Fallback ${pkg.root}: removed-test (${path})`);
        }
    }
  const originalAffected = new Set(affected);
  const runtimeAffected = new Set([
    ...changed,
    ...[...originalAffected].filter((path) => !candidateTests.has(path)),
  ]);
  for (const [analysis, files] of [
    [baseAnalysis, snapshots.base],
    [candidateAnalysis, snapshots.candidate],
  ] as const)
    for (const [file, unknown] of analysis.unknown) {
      const bounded = registry.impact.relationships.find(
        (contract) =>
          guardsMatch(contract.guards, files) &&
          contract.boundedConsumers?.[file] ===
            createHash("sha256").update(files[file]).digest("hex"),
      );
      const lazyProducer = registry.impact.relationships.some(
        (contract) =>
          guardsMatch(contract.guards, files) &&
          guardsMatch(contract.lazyProducers, files) &&
          Boolean(contract.lazyProducers?.[file]),
      );
      const applicable = [...unknown].filter(([reason, scope]) => {
        if (lazyProducer && reason === "filesystem-or-process-dependency")
          return false;
        if (
          bounded?.kind === "data" &&
          [
            "filesystem-or-process-dependency",
            "directory-url",
            "unqualified-style-dependencies",
          ].includes(reason)
        )
          return false;
        const effectiveScope =
          bounded && reason === "filesystem-or-process-dependency"
            ? bounded.inputs
            : scope;
        return (
          originalAffected.has(file) ||
          effectiveScope === null ||
          effectiveScope.some((prefix) =>
            [...runtimeAffected].some((path) => contains(prefix, path)),
          )
        );
      });
      if (!applicable.length) continue;
      const inputScopes = sorted(
        applicable.flatMap(([reason, scope]) =>
          bounded && reason === "filesystem-or-process-dependency"
            ? bounded.inputs
            : (scope ?? ["."]),
        ),
      );
      const pkg = registry.impact.packages
        .filter((pkg) => contains(pkg.root, file))
        .sort((a, b) => b.root.length - a.root.length)[0];
      if (!pkg)
        throw new ValidationPlanError(
          "uncovered-input",
          `No proven containing suite for unknown dependency: ${file}`,
        );
      const consumers = closure(reverse, [file]);
      const tests = Object.keys(snapshots.candidate).filter(
        (path) =>
          consumers.has(path) &&
          pkg.testPatterns.some((pattern) => new Bun.Glob(pattern).match(path)),
      );
      const otherSuites = registry.checks.filter(
        (check) =>
          !unitChecks.has(check.id) &&
          check.membership.includes(file) &&
          check.profile.endsWith(":browser"),
      );
      const assetSuites = applicable.every(
        ([reason]) =>
          reason === "unqualified-style-dependencies" ||
          reason === "directory-url",
      )
        ? registry.checks.filter(
            (check) =>
              check.profile.startsWith(`${pkg.root}:`) &&
              (check.profile.endsWith(":package-build") ||
                check.profile.endsWith(":browser")),
          )
        : [];
      const implicitRunners = registry.impact.packages.filter((owner) =>
        runnerInputs.get(owner.root)?.has(file),
      );
      if (
        implicitRunners.length ||
        applicable.some(
          ([reason]) => reason === "unqualified-runner-configuration",
        )
      ) {
        for (const owner of implicitRunners.length ? implicitRunners : [pkg])
          selectUncertain(owner.fallbackChecks, inputScopes, true);
      } else if (
        tests.length &&
        pkg.unitChecks.length &&
        !applicable.some(([reason]) => reason.startsWith("unqualified-convex"))
      ) {
        tests.forEach((path) => affected.add(path));
        for (const test of tests) {
          const scopes = uncertainMemberInputs.get(test) ?? new Set<string>();
          inputScopes.forEach((scope) => scopes.add(scope));
          uncertainMemberInputs.set(test, scopes);
        }
        selectUncertain(pkg.unitChecks, []);
      } else if (otherSuites.length)
        selectUncertain(
          otherSuites.map((check) => check.id),
          inputScopes,
        );
      else if (assetSuites.length)
        selectUncertain(
          assetSuites.map((check) => check.id),
          inputScopes,
        );
      else selectUncertain(pkg.fallbackChecks, inputScopes, true);
      reasons.push(
        `Fallback ${pkg.root}: ${sorted(applicable.map(([reason]) => reason)).join(", ")} (${file})`,
      );
    }
  const byId = new Map(registry.checks.map((check) => [check.id, check]));
  const requiredPrerequisites = new Set<string>();
  const require = (id: string) => {
    for (const dependency of byId.get(id)!.prerequisites)
      if (!requiredPrerequisites.has(dependency)) {
        requiredPrerequisites.add(dependency);
        selected.add(dependency);
        require(dependency);
      }
  };
  [...selected].forEach(require);
  const partitions = new Map<string, string[]>();
  const publishingInputs = new Map<string[], boolean>();
  const inputCache = new Map<
    string,
    Pick<CanonicalValidationCheck, "inputs" | "absentInputs">
  >();
  const checks = registry.checks.flatMap((check) => {
    if (!selected.has(check.id)) return check;
    const pkg = registry.impact!.packages.find((pkg) =>
      pkg.unitChecks.includes(check.id),
    );
    const inventory = pkg
      ? sorted(
          Object.keys(snapshots.candidate).filter((file) =>
            pkg.testPatterns.some((pattern) =>
              new Bun.Glob(pattern).match(file),
            ),
          ),
        )
      : check.membership;
    const membership =
      unitChecks.has(check.id) &&
      !fallbackChecks.has(check.id) &&
      !requiredPrerequisites.has(check.id)
        ? inventory.filter((file) => affected.has(file))
        : inventory;
    if (
      unitChecks.has(check.id) &&
      !membership.length &&
      !requiredPrerequisites.has(check.id) &&
      !registry.alwaysRequired.includes(check.id)
    )
      selected.delete(check.id);
    const bind = (members: string[]) => {
      const scopes = check.profile.endsWith(":package-types")
        ? []
        : sorted([
            ...(uncertainInputs.get(check.id) ?? []),
            ...members.flatMap((member) => [
              ...(uncertainMemberInputs.get(member) ?? []),
            ]),
          ]);
      const broad = !unitChecks.has(check.id);
      const key = JSON.stringify([
        check.profile,
        check.cwd,
        check.inputs,
        check.absentInputs,
        // bindInputs already seeds every candidate path inside these scopes.
        // Such members cannot change its input closure; keep their actual
        // membership on the returned check, but share this invocation's binding.
        members.filter(
          (member) =>
            !Object.hasOwn(snapshots.candidate, member) ||
            !scopes.some((scope) => contains(scope, member)),
        ),
        scopes,
        broad,
      ]);
      const cached = inputCache.get(key);
      if (cached) return { ...check, membership: members, ...cached };
      const bound = bindInputs(
        check,
        registry,
        snapshots,
        candidateGraph,
        members,
        changed,
        broad,
        scopes,
        baseGraph,
        [baseData, candidateData],
      );
      inputCache.set(key, {
        inputs: bound.inputs,
        absentInputs: bound.absentInputs,
      });
      return bound;
    };
    if (!unitChecks.has(check.id) || !membership.length)
      return [bind(membership)];
    // Accumulate each partition once instead of repeatedly sorting its growing
    // input union for every member. Cached bindings share the same input arrays.
    const groups = new Map<
      boolean,
      {
        check: CanonicalValidationCheck;
        membership: Set<string>;
        inputs: Set<string>;
        absentInputs: Set<string>;
        bindings: Set<string[]>;
      }
    >();
    for (const member of membership) {
      const bound = bind([member]);
      let publishes = publishingInputs.get(bound.inputs);
      if (publishes === undefined) {
        publishes = [...bound.inputs, ...bound.absentInputs].some((path) =>
          publishing.some((contract) =>
            contract.inputs.some((prefix) => contains(prefix, path)),
          ),
        );
        publishingInputs.set(bound.inputs, publishes);
      }
      let group = groups.get(publishes);
      if (!group) {
        group = {
          check: {
            ...bound,
            id: publishes ? `${check.id}.publishing` : check.id,
          },
          membership: new Set(),
          inputs: new Set(),
          absentInputs: new Set(),
          bindings: new Set(),
        };
        groups.set(publishes, group);
      }
      group.membership.add(member);
      if (!group.bindings.has(bound.inputs)) {
        for (const path of bound.inputs) group.inputs.add(path);
        for (const path of bound.absentInputs) group.absentInputs.add(path);
        group.bindings.add(bound.inputs);
      }
    }
    const result = [...groups.values()].map((group) => ({
      ...group.check,
      membership: sorted(group.membership),
      inputs: sorted(group.inputs),
      absentInputs: sorted(group.absentInputs),
    }));
    partitions.set(
      check.id,
      result.map((group) => group.id),
    );
    return result;
  });
  if (!selected.size)
    throw new ValidationPlanError(
      "uncovered-input",
      "No containing obligation covers the affected source.",
    );
  return {
    ...registry,
    checks: checks.map((check) => ({
      ...check,
      prerequisites: check.prerequisites.flatMap(
        (id) => partitions.get(id) ?? [id],
      ),
      supersedes: check.supersedes.flatMap((item) =>
        (partitions.get(item.checkId) ?? [item.checkId]).map((checkId) => ({
          ...item,
          checkId,
        })),
      ),
    })),
    alwaysRequired: registry.alwaysRequired.flatMap(
      (id) => partitions.get(id) ?? [id],
    ),
    impact: {
      ...registry.impact,
      packages: registry.impact.packages.map((pkg) => ({
        ...pkg,
        unitChecks: pkg.unitChecks.flatMap((id) => partitions.get(id) ?? [id]),
        fallbackChecks: pkg.fallbackChecks.flatMap(
          (id) => partitions.get(id) ?? [id],
        ),
      })),
    },
    surfaces: changed.map((path, index) => ({
      id: `affected.${index}`,
      pathPrefixes: [path],
      checks: sorted([...selected].flatMap((id) => partitions.get(id) ?? [id])),
      // Every affected surface selects the same checks. Attach the complete
      // shared diagnostics once; repeating them for every changed path makes
      // each final check's reasons grow as changes times diagnostic count.
      reason:
        index === 0
          ? `Affected consumers across base and candidate: ${sorted(reasons).join("; ")}`
          : "Affected consumers across base and candidate (shared diagnostics: affected.0)",
    })),
  };
}

/** Full fallback is the authored Bun execution, not an emulation of Bun's env in
 * the exact-membership Node helper. Only a characterized complete ordinary suite
 * may cover both obligations; narrowed runs retain their exact-membership guard.
 */
export function resolveValidationImpact(
  registry: CanonicalValidationRegistry,
  changes: ValidationChange[],
  snapshots: ValidationSnapshots,
  fullHealth = false,
): CanonicalValidationRegistry {
  const resolved = resolveConsumerImpact(
    registry,
    changes,
    snapshots,
    fullHealth,
  );
  const contract = OPERATOR_FULL_UNIT_CONTRACT;
  const pkg = resolved.impact!.packages.find(
    (item) => item.root === contract.root,
  );
  if (
    !pkg ||
    JSON.stringify(pkg.testPatterns) !== JSON.stringify([contract.testPattern])
  )
    return resolved;
  for (const files of [snapshots.base, snapshots.candidate]) {
    try {
      const manifest = JSON.parse(files[`${contract.root}/package.json`]);
      const rootManifest = JSON.parse(files["package.json"]);
      if (
        manifest.name !== contract.workspace ||
        manifest.scripts?.test !== "vitest run --maxWorkers=4" ||
        manifest.scripts?.pretest !== undefined ||
        manifest.scripts?.posttest !== undefined ||
        manifest.devDependencies?.vitest !== "4.1.11" ||
        rootManifest.packageManager !== "bun@1.1.29"
      )
        return resolved;
    } catch {
      return resolved;
    }
    if (
      Object.entries(contract.sources).some(
        ([path, digest]) =>
          files[path] === undefined ||
          createHash("sha256").update(files[path]).digest("hex") !== digest,
      )
    )
      return resolved;
    // Alternative config/project discovery is not part of the characterized suite.
    if (
      Object.keys(files).some(
        (path) =>
          [".", contract.root].includes(posix.dirname(path)) &&
          /^vitest[.](config|workspace|projects)[.]/.test(
            posix.basename(path),
          ) &&
          path !== `${contract.root}/vitest.config.ts`,
      )
    )
      return resolved;
  }
  const selected = new Set(
    fullHealth
      ? resolved.checks.map((c) => c.id)
      : [
          ...resolved.alwaysRequired,
          ...resolved.surfaces.flatMap((surface) => surface.checks),
        ],
  );
  const byId = new Map(resolved.checks.map((check) => [check.id, check]));
  const require = (id: string) => {
    for (const prerequisite of byId.get(id)!.prerequisites)
      if (!selected.has(prerequisite)) {
        selected.add(prerequisite);
        require(prerequisite);
      }
  };
  [...selected].forEach(require);
  const fallback = resolved.checks.find(
    (check) =>
      selected.has(check.id) &&
      pkg.fallbackChecks.includes(check.id) &&
      check.profile === `${contract.root}:fallback-suite` &&
      check.cwd === "." &&
      JSON.stringify(check.argv) ===
        JSON.stringify(["bun", "run", "--filter", contract.workspace, "test"]),
  );
  if (!fallback || fallback.membership.length) return resolved;
  const membership = sorted(
    Object.keys(snapshots.candidate).filter((path) =>
      new Bun.Glob(contract.testPattern).match(path),
    ),
  );
  if (
    !membership.length ||
    membership.some(
      (path) =>
        /\/(node_modules|[.]git)\//.test(path) ||
        Object.hasOwn(snapshots.links?.candidate ?? {}, path),
    )
  )
    return resolved;
  const units = resolved.checks.filter(
    (check) => selected.has(check.id) && pkg.unitChecks.includes(check.id),
  );
  const allMembers = new Set(membership);
  if (
    !units.length ||
    units.some(
      (check) =>
        check.profile !== `${contract.root}:unit` ||
        check.cwd !== contract.root ||
        JSON.stringify(check.argv) !==
          JSON.stringify(["bun", "run", "test", "--"]) ||
        !check.membership.length ||
        check.membership.some((path) => !allMembers.has(path)),
    ) ||
    JSON.stringify(sorted(units.flatMap((check) => check.membership))) !==
      JSON.stringify(membership)
  )
    return resolved;
  const group = [fallback, ...units];
  const groupIds = new Set(group.map((check) => check.id));
  // Do not absorb an obligation that another command needs to execute first.
  if (
    group.some((check) => check.supersedes.length) ||
    resolved.checks.some(
      (check) =>
        check.prerequisites.some((id) => groupIds.has(id)) ||
        check.supersedes.some((entry) => groupIds.has(entry.checkId)),
    )
  )
    return resolved;
  const execution = {
    // Every normalized member carries the same complete declaration so strict
    // grouping preserves both one execution and each original profile binding.
    ordinaryFullSuite: {
      contract: "athena-operator-full-unit/1" as const,
      coveredProfiles: group
        .map(({ id, profile }) => ({ checkId: id, profile }))
        .sort((a, b) => a.checkId.localeCompare(b.checkId)),
    },
    argv: fallback.argv,
    cwd: fallback.cwd,
    profile: fallback.profile,
    membership,
    inputs: sorted(group.flatMap((check) => check.inputs)),
    absentInputs: sorted(group.flatMap((check) => check.absentInputs)),
    prerequisites: sorted(group.flatMap((check) => check.prerequisites)),
  };
  return {
    ...resolved,
    checks: resolved.checks.map((check) =>
      groupIds.has(check.id) ? { ...check, ...execution } : check,
    ),
    impact: {
      ...resolved.impact!,
      packages: resolved.impact!.packages.map((item) => ({
        ...item,
        unitChecks: item.unitChecks.filter((id) => !groupIds.has(id)),
      })),
    },
  };
}
