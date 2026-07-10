import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GUARDED_TABLES = new Set(["registerSession", "posLocalSyncMapping"]);
const WRITE_METHODS = new Set(["insert", "patch", "replace", "delete"]);
const ALLOWED_WRITERS = new Map([
  ["registerSession", "convex/operations/registerSessionAuthorityRevision.ts"],
  [
    "posLocalSyncMapping",
    "convex/pos/application/sync/registerMappingAuthorityRevision.ts",
  ],
]);
const ALLOWED_IMPLICIT_WRITES = new Set([
  "convex/migrations/migrateAmountsToPesewas.ts:patch:order._id",
  "convex/migrations/migrateAmountsToPesewas.ts:patch:session._id",
  "convex/migrations/migrateAmountsToPesewas.ts:patch:store._id",
  "convex/migrations/migrateAmountsToPesewas.ts:patch:sku._id",
  "convex/migrations/migrateAmountsToPesewas.ts:patch:item._id",
  "convex/inventory/organizationMembers.ts:patch:member._id",
  "convex/inventory/organizations.ts:patch:args.id",
  "convex/inventory/organizations.ts:delete:args.id",
]);

export type RegisterSessionAuthorityWriterFinding = {
  file: string;
  line: number;
  method: string;
  table: string;
};

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function collectRegisterSessionAuthorityWriterFindings(
  file: string,
  source: string,
): RegisterSessionAuthorityWriterFinding[] {
  const normalizedFile = normalizePath(file);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings: RegisterSessionAuthorityWriterFinding[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_METHODS.has(node.expression.name.text)
    ) {
      const tableArgument = node.arguments[0];
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const isDirectDbCall =
        ts.isPropertyAccessExpression(receiver) && receiver.name.text === "db";
      const implicitIdWrite =
        isDirectDbCall && (method === "patch" || method === "replace")
          ? node.arguments.length === 2
          : isDirectDbCall && method === "delete" && node.arguments.length === 1;
      if (implicitIdWrite && tableArgument) {
        const implicitKey = `${normalizedFile}:${method}:${tableArgument.getText(sourceFile)}`;
        if (
          ![...ALLOWED_IMPLICIT_WRITES].some((allowed) =>
            implicitKey.endsWith(allowed),
          )
        ) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          findings.push({
            file: normalizedFile,
            line: line + 1,
            method,
            table: "implicit-id",
          });
        }
      }
      if (
        tableArgument &&
        (ts.isStringLiteral(tableArgument) ||
          ts.isNoSubstitutionTemplateLiteral(tableArgument)) &&
        GUARDED_TABLES.has(tableArgument.text)
      ) {
        const allowedWriter = ALLOWED_WRITERS.get(tableArgument.text);
        if (!allowedWriter || !normalizedFile.endsWith(allowedWriter)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          findings.push({
            file: normalizedFile,
            line: line + 1,
            method,
            table: tableArgument.text,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "_generated" ? [] : listTypeScriptFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

const DEFAULT_REPO_ROOT = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);

export function checkRegisterSessionAuthorityWriters(
  repoRoot = DEFAULT_REPO_ROOT,
) {
  const convexRoot = resolve(repoRoot, "packages/athena-webapp/convex");
  return listTypeScriptFiles(convexRoot).flatMap((file) =>
    collectRegisterSessionAuthorityWriterFindings(
      relative(repoRoot, file),
      readFileSync(file, "utf8"),
    ),
  );
}

if (import.meta.main) {
  const findings = checkRegisterSessionAuthorityWriters();
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `${finding.file}:${finding.line} raw ${finding.method} of ${finding.table} bypasses authority revision`,
      );
    }
    process.exit(1);
  }
  console.log("Register-session authority writers are centralized.");
}
