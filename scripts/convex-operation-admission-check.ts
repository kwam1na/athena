import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export type OperationAdmissionSeverity = "high" | "medium" | "low";

export type PublicMutationExport = {
  functionName: string;
  hasOperationAdmissionWrapper: boolean;
  moduleName: string;
  exportName: string;
  filePath: string;
  line: number;
};

export type OperationAdmissionDefinition = {
  operationId?: string;
  functionName?: string;
  convexFunction?: string;
  publicFunction?: string;
  capability?: string;
};

export type LegacyOperationAdmissionExemption = {
  functionName: string;
  capability: string;
  wave: string;
  owner: string;
  reason: string;
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

export type OperationAdmissionCheckResult = {
  discoveredPublicMutations: PublicMutationExport[];
  coveredByDefinitions: PublicMutationExport[];
  coveredByLegacyExemptions: PublicMutationExport[];
  findings: OperationAdmissionFinding[];
};

type CheckOptions = {
  operationDefinitions?: readonly OperationAdmissionDefinition[];
  legacyExemptions?: readonly LegacyOperationAdmissionExemption[];
};

const DEFAULT_REPO_ROOT = process.cwd();

function normalizeRepoPath(filePath: string) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function slugifyForFindingId(value: string) {
  return normalizeRepoPath(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isGeneratedServerImport(moduleSpecifier: string) {
  return moduleSpecifier.endsWith("_generated/server");
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

function toConvexModuleName(filePath: string) {
  const normalized = normalizeRepoPath(filePath);
  return normalized
    .replace(/^.*packages\/athena-webapp\/convex\//, "")
    .replace(/\.ts$/, "");
}

function getImportedConvexRegistrationNames(sourceFile: ts.SourceFile) {
  const mutationNames = new Set<string>();
  const serverNamespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!isGeneratedServerImport(statement.moduleSpecifier.text)) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause) {
      continue;
    }

    const namedBindings = importClause.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      serverNamespaces.add(namedBindings.name.text);
      continue;
    }

    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue;
    }

    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === "mutation") {
        mutationNames.add(element.name.text);
      }
    }
  }

  return { mutationNames, serverNamespaces };
}

function isPublicMutationCall(
  expression: ts.Expression,
  mutationNames: ReadonlySet<string>,
  serverNamespaces: ReadonlySet<string>,
) {
  if (ts.isIdentifier(expression)) {
    return mutationNames.has(expression.text);
  }

  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "mutation" &&
    ts.isIdentifier(expression.expression) &&
    serverNamespaces.has(expression.expression.text)
  );
}

function isOperationAdmissionWrapperCall(expression: ts.Expression) {
  return (
    ts.isCallExpression(expression) &&
    ((ts.isIdentifier(expression.expression) &&
      expression.expression.text === "admitPublicMutation") ||
      (ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === "admitPublicMutation"))
  );
}

function getOperationAdmissionWrapperNames(sourceFile: ts.SourceFile) {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        isOperationAdmissionWrapperCall(declaration.initializer)
      ) {
        names.add(declaration.name.text);
      }
    }
  }

  return names;
}

function mutationCallHasOperationAdmissionWrapper(
  callExpression: ts.CallExpression,
  wrapperNames: ReadonlySet<string>,
) {
  const [config] = callExpression.arguments;
  if (!config || !ts.isObjectLiteralExpression(config)) {
    return false;
  }

  return config.properties.some((property) => {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isIdentifier(property.name) ||
      property.name.text !== "handler"
    ) {
      return false;
    }
    return (
      isOperationAdmissionWrapperCall(property.initializer) ||
      (ts.isIdentifier(property.initializer) &&
        wrapperNames.has(property.initializer.text)) ||
      handlerCallsOperationAdmissionWrapper(property.initializer, wrapperNames)
    );
  });
}

function handlerCallsOperationAdmissionWrapper(
  expression: ts.Expression,
  wrapperNames: ReadonlySet<string>,
) {
  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) {
    return false;
  }

  let found = false;
  function visit(node: ts.Node) {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      wrapperNames.has(node.expression.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(expression.body);
  return found;
}

function hasExportModifier(node: ts.Node) {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
  );
}

export function collectPublicMutationExportsFromSource(
  filePath: string,
  source: string,
): PublicMutationExport[] {
  if (isExcludedConvexSourcePath(filePath)) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const { mutationNames, serverNamespaces } =
    getImportedConvexRegistrationNames(sourceFile);
  const wrapperNames = getOperationAdmissionWrapperNames(sourceFile);
  const moduleName = toConvexModuleName(filePath);
  const exports: PublicMutationExport[] = [];

  function pushExport(
    exportName: string,
    node: ts.Node,
    mutationCall: ts.CallExpression,
  ) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    exports.push({
      functionName: `${moduleName}:${exportName}`,
      hasOperationAdmissionWrapper:
        mutationCallHasOperationAdmissionWrapper(mutationCall, wrapperNames),
      moduleName,
      exportName,
      filePath: normalizeRepoPath(filePath),
      line: line + 1,
    });
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue;
        }
        if (
          ts.isCallExpression(declaration.initializer) &&
          isPublicMutationCall(
            declaration.initializer.expression,
            mutationNames,
            serverNamespaces,
          )
        ) {
          pushExport(declaration.name.text, declaration, declaration.initializer);
        }
      }
      continue;
    }

    if (
      ts.isExportAssignment(statement) &&
      ts.isCallExpression(statement.expression) &&
      isPublicMutationCall(
        statement.expression.expression,
        mutationNames,
        serverNamespaces,
      )
    ) {
      pushExport("default", statement, statement.expression);
    }
  }

  return exports;
}

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

export async function discoverPublicMutationExports(repoRoot: string) {
  const convexRoot = path.join(repoRoot, "packages/athena-webapp/convex");
  const files = await listConvexSourceFiles(convexRoot);
  const discovered = await Promise.all(
    files.map(async (filePath) =>
      collectPublicMutationExportsFromSource(
        path.relative(repoRoot, filePath),
        await readFile(filePath, "utf8"),
      ),
    ),
  );
  return discovered
    .flat()
    .sort((left, right) => left.functionName.localeCompare(right.functionName));
}

function getDefinitionFunctionName(definition: OperationAdmissionDefinition) {
  return (
    definition.functionName ??
    definition.convexFunction ??
    definition.publicFunction ??
    definition.operationId
  );
}

function pushFinding(
  findings: OperationAdmissionFinding[],
  finding: OperationAdmissionFinding,
) {
  findings.push(finding);
}

function validateDefinitionInventory(
  definitions: readonly OperationAdmissionDefinition[],
) {
  const findings: OperationAdmissionFinding[] = [];
  const seen = new Map<string, OperationAdmissionDefinition>();

  for (const definition of definitions) {
    const functionName = getDefinitionFunctionName(definition);
    if (!functionName) {
      pushFinding(findings, {
        id: "operation-definition-missing-function-name",
        severity: "high",
        title: "Operation admission definition is missing a public function name",
        filePath:
          "packages/athena-webapp/convex/operationAdmission/definitions.ts",
        rationale:
          "The static checker needs a stable functionName, convexFunction, publicFunction, or operationId value to match public mutation exports.",
        remediation:
          "Add a stable public mutation reference such as `functionName: \"module/export:mutationName\"` to the operation definition.",
      });
      continue;
    }

    if (!definition.capability) {
      pushFinding(findings, {
        id: `operation-definition-missing-capability-${slugifyForFindingId(functionName)}`,
        severity: "high",
        title: "Operation admission definition is missing a capability",
        filePath:
          "packages/athena-webapp/convex/operationAdmission/definitions.ts",
        functionName,
        rationale:
          "Public write admission must declare the capability it protects before handler execution.",
        remediation:
          "Add a valid catalog capability to the operation definition.",
      });
    }

    if (seen.has(functionName)) {
      pushFinding(findings, {
        id: `duplicate-operation-definition-${slugifyForFindingId(functionName)}`,
        severity: "high",
        title: "Duplicate operation admission definition",
        filePath:
          "packages/athena-webapp/convex/operationAdmission/definitions.ts",
        functionName,
        rationale:
          "A public mutation can only have one operation admission definition; duplicate definitions make capability drift ambiguous.",
        remediation:
          "Collapse the duplicate entries into one definition for this public mutation.",
      });
    }
    seen.set(functionName, definition);
  }

  return findings;
}

function validateLegacyInventory(
  legacyExemptions: readonly LegacyOperationAdmissionExemption[],
) {
  const findings: OperationAdmissionFinding[] = [];
  const seen = new Map<string, LegacyOperationAdmissionExemption>();

  for (const exemption of legacyExemptions) {
    if (!exemption.functionName) {
      pushFinding(findings, {
        id: "legacy-operation-exemption-missing-function-name",
        severity: "high",
        title: "Legacy operation admission exemption is missing a function name",
        filePath:
          "packages/athena-webapp/convex/operationAdmission/migrationInventory.ts",
        rationale:
          "Every legacy exemption must name the exact public mutation it covers so new raw writes cannot hide behind a module-level allowlist.",
        remediation:
          "Add the exact `moduleName:exportName` functionName for this exemption.",
      });
      continue;
    }

    const missingFields = ["capability", "wave", "owner", "reason"].filter(
      (field) => !exemption[field as keyof LegacyOperationAdmissionExemption],
    );
    if (missingFields.length > 0) {
      pushFinding(findings, {
        id: `legacy-operation-exemption-incomplete-${slugifyForFindingId(exemption.functionName)}`,
        severity: "high",
        title: "Legacy operation admission exemption is incomplete",
        filePath:
          "packages/athena-webapp/convex/operationAdmission/migrationInventory.ts",
        functionName: exemption.functionName,
        rationale: `The legacy exemption is missing ${missingFields.join(", ")}.`,
        remediation:
          "Give the exemption a capability, migration wave, owner, and reason.",
      });
    }

    if (seen.has(exemption.functionName)) {
      pushFinding(findings, {
        id: `duplicate-legacy-operation-exemption-${slugifyForFindingId(exemption.functionName)}`,
        severity: "high",
        title: "Duplicate legacy operation admission exemption",
        filePath:
          "packages/athena-webapp/convex/operationAdmission/migrationInventory.ts",
        functionName: exemption.functionName,
        rationale:
          "A public mutation can only have one legacy migration inventory entry; duplicates make wave ownership ambiguous.",
        remediation:
          "Remove the duplicate exemption or merge its metadata into the single canonical entry.",
      });
    }
    seen.set(exemption.functionName, exemption);
  }

  return findings;
}

export async function collectOperationAdmissionCheckResult(
  repoRoot: string,
  options: CheckOptions = {},
): Promise<OperationAdmissionCheckResult> {
  const operationDefinitions =
    options.operationDefinitions ?? (await loadOperationDefinitions(repoRoot));
  const legacyExemptions =
    options.legacyExemptions ?? (await loadLegacyExemptions(repoRoot));
  const discoveredPublicMutations = await discoverPublicMutationExports(repoRoot);
  const definitionNames = new Set(
    operationDefinitions.map(getDefinitionFunctionName).filter(Boolean),
  );
  const legacyNames = new Set(
    legacyExemptions.map((exemption) => exemption.functionName).filter(Boolean),
  );
  const discoveredNames = new Set(
    discoveredPublicMutations.map((entry) => entry.functionName),
  );
  const findings = [
    ...validateDefinitionInventory(operationDefinitions),
    ...validateLegacyInventory(legacyExemptions),
  ];

  const coveredByDefinitions: PublicMutationExport[] = [];
  const coveredByLegacyExemptions: PublicMutationExport[] = [];

  for (const publicMutation of discoveredPublicMutations) {
    if (definitionNames.has(publicMutation.functionName)) {
      if (!publicMutation.hasOperationAdmissionWrapper) {
        pushFinding(findings, {
          id: `definition-covered-mutation-missing-admission-wrapper-${slugifyForFindingId(publicMutation.functionName)}`,
          severity: "high",
          title:
            "Defined public Convex write mutation does not use operation admission wrapper",
          filePath: publicMutation.filePath,
          line: publicMutation.line,
          functionName: publicMutation.functionName,
          rationale:
            "A matching operation definition only proves inventory coverage. Migrated public writes must route their mutation handler through admitPublicMutation so actor, scope, readiness, capability, and effect policy run before domain writes.",
          remediation:
            "Wrap this mutation handler with `admitPublicMutation(definition, domainHandler, ...)`, or move it back to the exact legacy exemption inventory until it is migrated.",
        });
      }
      coveredByDefinitions.push(publicMutation);
      continue;
    }
    if (legacyNames.has(publicMutation.functionName)) {
      coveredByLegacyExemptions.push(publicMutation);
      continue;
    }

    pushFinding(findings, {
      id: `missing-operation-admission-coverage-${slugifyForFindingId(publicMutation.functionName)}`,
      severity: "high",
      title: "Public Convex write mutation lacks operation admission coverage",
      filePath: publicMutation.filePath,
      line: publicMutation.line,
      functionName: publicMutation.functionName,
      rationale:
        "Every exported public Convex mutation must either have an operation admission definition or an exact named legacy migration exemption. Public actions are intentionally out of scope for this checker.",
      remediation:
        "Add an operation definition for this mutation, or add a temporary named legacy exemption in operationAdmission/migrationInventory.ts with owner, wave, reason, and capability metadata.",
    });
  }

  const inventoryNames = [...definitionNames, ...legacyNames].filter(
    (functionName): functionName is string => typeof functionName === "string",
  );
  for (const functionName of inventoryNames.sort()) {
    if (!discoveredNames.has(functionName)) {
      pushFinding(findings, {
        id: `stale-operation-admission-entry-${slugifyForFindingId(functionName)}`,
        severity: "medium",
        title: "Operation admission inventory entry does not match a public mutation",
        filePath: functionName.includes(":")
          ? "packages/athena-webapp/convex"
          : "packages/athena-webapp/convex/operationAdmission",
        functionName,
        rationale:
          "The checker could not find a current exported public mutation matching this definition or legacy exemption.",
        remediation:
          "Remove stale inventory or update its functionName after a mutation is renamed or deleted.",
      });
    }
  }

  return {
    discoveredPublicMutations,
    coveredByDefinitions,
    coveredByLegacyExemptions,
    findings,
  };
}

async function loadOperationDefinitions(
  repoRoot: string,
): Promise<OperationAdmissionDefinition[]> {
  const definitionsPath = path.join(
    repoRoot,
    "packages/athena-webapp/convex/operationAdmission/definitions.ts",
  );
  if (!(await fileExists(definitionsPath))) {
    return [];
  }

  const module = (await import(pathToFileURL(definitionsPath).href)) as {
    OPERATION_ADMISSION_DEFINITIONS?: OperationAdmissionDefinition[];
    operationAdmissionDefinitions?: OperationAdmissionDefinition[];
  };
  return (
    module.OPERATION_ADMISSION_DEFINITIONS ??
    module.operationAdmissionDefinitions ??
    []
  );
}

async function loadLegacyExemptions(
  repoRoot: string,
): Promise<LegacyOperationAdmissionExemption[]> {
  const inventoryPath = path.join(
    repoRoot,
    "packages/athena-webapp/convex/operationAdmission/migrationInventory.ts",
  );
  if (!(await fileExists(inventoryPath))) {
    return [];
  }

  const module = (await import(pathToFileURL(inventoryPath).href)) as {
    OPERATION_ADMISSION_LEGACY_EXEMPTIONS?: LegacyOperationAdmissionExemption[];
    operationAdmissionLegacyExemptions?: LegacyOperationAdmissionExemption[];
  };
  return (
    module.OPERATION_ADMISSION_LEGACY_EXEMPTIONS ??
    module.operationAdmissionLegacyExemptions ??
    []
  );
}

function formatFinding(finding: OperationAdmissionFinding) {
  const location = finding.line
    ? `${finding.filePath}:${finding.line}`
    : finding.filePath;
  const functionName = finding.functionName ? ` ${finding.functionName}` : "";
  return `${location} [${finding.severity}]${functionName} ${finding.title}\n  ${finding.rationale}\n  ${finding.remediation}`;
}

if (import.meta.main) {
  const result = await collectOperationAdmissionCheckResult(DEFAULT_REPO_ROOT);
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(formatFinding(finding));
    }
    console.error(
      `Operation admission coverage failed: ${result.findings.length} finding(s), ${result.discoveredPublicMutations.length} public mutation(s) discovered.`,
    );
    process.exit(1);
  }

  console.log(
    `Operation admission coverage passed: ${result.discoveredPublicMutations.length} public mutation(s), ${result.coveredByDefinitions.length} definition(s), ${result.coveredByLegacyExemptions.length} legacy exemption(s).`,
  );
}
