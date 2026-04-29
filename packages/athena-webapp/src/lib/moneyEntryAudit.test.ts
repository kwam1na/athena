import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

type ReviewedRawParse = {
  file: string;
  reason: string;
  textIncludes: string;
};

type RawParseFinding = {
  file: string;
  line: string;
  lineNumber: number;
  reason: string;
};

const webappRoot = process.cwd();
const sourceRoot = join(webappRoot, "src");

const reviewedRawParses: ReviewedRawParse[] = [
  {
    file: "src/components/cash-controls/RegisterSessionView.tsx",
    textIncludes: "parsedAmount = Number(amount)",
    reason:
      "Backend-owned conversion boundary: cash deposit mutation converts display amount with toPesewas.",
  },
  {
    file: "src/components/promo-codes/PromoCodePreview.tsx",
    textIncludes: "Number.parseFloat(discount)",
    reason: "Display-only preview formatting. V26-369 covers mutation persistence.",
  },
  {
    file: "src/components/store-configuration/components/FeesView.tsx",
    textIncludes: "Number.parseFloat(e.target.value)",
    reason:
      "Display-unit local state for fees; submit path converts with toPesewas before persistence.",
  },
  {
    file: "src/components/assets/index.tsx",
    textIncludes: "setEnteredWithinAccraFee(parseInt(e.target.value))",
    reason:
      "Legacy assets fee editor stores display-unit local state and persists through updateStoreConfiguration.",
  },
  {
    file: "src/components/assets/index.tsx",
    textIncludes: "setEnteredOtherRegionsFee(parseInt(e.target.value))",
    reason:
      "Legacy assets fee editor stores display-unit local state and persists through updateStoreConfiguration.",
  },
  {
    file: "src/components/assets/index.tsx",
    textIncludes: "setEnteredIntlFee(parseInt(e.target.value))",
    reason:
      "Legacy assets fee editor stores display-unit local state and persists through updateStoreConfiguration.",
  },
  {
    file: "src/components/orders/ReturnExchangeView.tsx",
    textIncludes: "unitPrice = Number(replacementUnitPrice)",
    reason:
      "Replacement unit price is a characterized legacy exchange boundary; not converted in this guardrail change.",
  },
  {
    file: "src/lib/pos/displayAmounts.ts",
    textIncludes: "displayAmount = Number.parseFloat(numericValue)",
    reason:
      "Shared parser implementation: raw parse is contained inside parseDisplayAmountInput.",
  },
  {
    file: "src/components/cash-controls/formatReviewReason.ts",
    textIncludes: "formatStoredAmount(formatter, Number(rawVariance))",
    reason:
      "Display-only formatting for a backend-generated minor-unit variance reason; no persisted money input boundary.",
  },
];

const nonMoneyContextTerms = [
  "count",
  "duration",
  "height",
  "hour",
  "length",
  "limit",
  "minute",
  "page",
  "percent",
  "percentage",
  "quantity",
  "rate",
  "reel",
  "size",
  "stock",
  "tax",
  "time",
  "version",
  "weight",
  "width",
];

function readWebappFile(file: string): string {
  return readFileSync(join(webappRoot, file), "utf8");
}

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(dir, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(absolutePath);
    }

    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }

    if (
      /\.(test|spec|stories)\.(ts|tsx)$/.test(entry.name) ||
      entry.name.endsWith(".d.ts")
    ) {
      return [];
    }

    return [relative(webappRoot, absolutePath)];
  });
}

function isRawNumericParse(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  const expression = node.expression;

  if (ts.isIdentifier(expression)) {
    return ["Number", "parseFloat", "parseInt"].includes(expression.text);
  }

  if (!ts.isPropertyAccessExpression(expression)) {
    return false;
  }

  return (
    expression.expression.getText() === "Number" &&
    ["parseFloat", "parseInt"].includes(expression.name.text)
  );
}

function containsTerm(text: string, terms: string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function referencesMoney(text: string): boolean {
  return containsTerm(text, [
    "amount",
    "balance",
    "cash",
    "cost",
    "deposit",
    "discount",
    "fee",
    "payment",
    "price",
  ]);
}

function referencesOnlyNonMoneyNumericContext(text: string): boolean {
  return !referencesMoney(text) && containsTerm(text, nonMoneyContextTerms);
}

function reviewedReason(
  file: string,
  source: string,
  contextText: string
): string | undefined {
  return reviewedRawParses.find((entry) => {
    return (
      entry.file === file &&
      source.includes(entry.textIncludes) &&
      contextText.includes(entry.textIncludes)
    );
  })?.reason;
}

function nodeLine(sourceFile: ts.SourceFile, node: ts.Node): {
  line: string;
  lineNumber: number;
} {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return {
    line: sourceFile.text.split("\n")[position.line]?.trim() ?? node.getText(),
    lineNumber: position.line + 1,
  };
}

function ancestorChain(node: ts.Node): ts.Node[] {
  const ancestors: ts.Node[] = [];
  let current: ts.Node | undefined = node;

  while (current) {
    ancestors.push(current);
    current = current.parent;
  }

  return ancestors;
}

function nearestContextNode(node: ts.Node): ts.Node {
  return (
    ancestorChain(node).slice(1).find((ancestor) => {
      return (
        ts.isPropertyAssignment(ancestor) ||
        ts.isVariableDeclaration(ancestor) ||
        ts.isBinaryExpression(ancestor) ||
        ts.isCallExpression(ancestor) ||
        ts.isJsxExpression(ancestor) ||
        ts.isReturnStatement(ancestor) ||
        ts.isExpressionStatement(ancestor)
      );
    }) ?? node
  );
}

function isAllowedPercentageBranch(node: ts.Node): boolean {
  return ancestorChain(node).some((ancestor) => {
    if (ts.isConditionalExpression(ancestor)) {
      return ancestor.condition.getText().toLowerCase().includes("percentage");
    }

    if (ts.isIfStatement(ancestor)) {
      return ancestor.expression.getText().toLowerCase().includes("percentage");
    }

    return false;
  });
}

function isAllowedDisplayConversion(node: ts.CallExpression): boolean {
  return ancestorChain(node).some((ancestor) => {
    if (!ts.isCallExpression(ancestor)) {
      return false;
    }

    return ancestor.expression.getText().includes("parseDisplayAmountInput");
  });
}

function isAllowedNumericRounding(node: ts.CallExpression): boolean {
  const [argument] = node.arguments;

  return (
    argument !== undefined &&
    ts.isCallExpression(argument) &&
    ts.isPropertyAccessExpression(argument.expression) &&
    argument.expression.name.text === "toFixed"
  );
}

function containsDisallowedRawNumericParse(node: ts.Node): boolean {
  if (isRawNumericParse(node) && !isAllowedNumericRounding(node)) {
    return true;
  }

  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsDisallowedRawNumericParse(child)) {
      found = true;
    }
  });

  return found;
}

function returnsRawNumericParse(node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression): boolean {
  if (!node.body) {
    return false;
  }

  if (!ts.isBlock(node.body)) {
    return containsDisallowedRawNumericParse(node.body);
  }

  const [statement] = node.body.statements;

  return (
    node.body.statements.length === 1 &&
    statement !== undefined &&
    ts.isReturnStatement(statement) &&
    statement.expression !== undefined &&
    containsDisallowedRawNumericParse(statement.expression)
  );
}

function collectRawNumericHelperNames(sourceFile: ts.SourceFile): Set<string> {
  const helperNames = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && returnsRawNumericParse(node)) {
      helperNames.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      returnsRawNumericParse(node.initializer)
    ) {
      helperNames.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return helperNames;
}

function collectRawMoneyParsesFromSource(
  file: string,
  source: string
): RawParseFinding[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const findings: RawParseFinding[] = [];
  const rawNumericHelperNames = collectRawNumericHelperNames(sourceFile);

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      rawNumericHelperNames.has(node.expression.text)
    ) {
      const contextNode = nearestContextNode(node);
      const contextText = contextNode.getText();

      if (
        !isAllowedPercentageBranch(node) &&
        !referencesOnlyNonMoneyNumericContext(contextText) &&
        referencesMoney(contextText)
      ) {
        findings.push({
          file,
          ...nodeLine(sourceFile, node),
          reason:
            "Helper wrapping raw numeric parsing is used in a money-entry context.",
        });
      }
    }

    if (!isRawNumericParse(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const contextNode = nearestContextNode(node);
    const contextText = contextNode.getText();
    const parseText = node.getText();
    const reason = reviewedReason(file, source, contextText);

    if (
      reason ||
      isAllowedDisplayConversion(node) ||
      isAllowedNumericRounding(node) ||
      isAllowedPercentageBranch(node) ||
      referencesOnlyNonMoneyNumericContext(contextText)
    ) {
      ts.forEachChild(node, visit);
      return;
    }

    if (referencesMoney(`${contextText} ${parseText}`)) {
      findings.push({
        file,
        ...nodeLine(sourceFile, node),
        reason: "Raw numeric parsing appears in a money-entry context.",
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function collectRawMoneyParses(): RawParseFinding[] {
  return collectSourceFiles(sourceRoot).flatMap((file) => {
    return collectRawMoneyParsesFromSource(file, readWebappFile(file));
  });
}

describe("money entry audit", () => {
  it("catches raw numeric parses when the money field is declared in the surrounding payload", () => {
    const source = `
const payload = {
  depositValue: form.depositValue.trim()
    ? Number(form.depositValue)
    : undefined,
};
`;

    expect(
      collectRawMoneyParsesFromSource(
        "src/components/example/NewMoneyView.tsx",
        source
      )
    ).toEqual([
      expect.objectContaining({
        file: "src/components/example/NewMoneyView.tsx",
        lineNumber: 4,
      }),
    ]);
  });

  it("allows raw numeric parses only in explicit percentage branches", () => {
    const source = `
const payload = {
  discountValue:
    discountType === "percentage"
      ? Number.parseFloat(discountInput)
      : parseDisplayAmountInput(discountInput),
};
`;

    expect(
      collectRawMoneyParsesFromSource(
        "src/components/example/DiscountView.tsx",
        source
      )
    ).toEqual([]);
  });

  it("catches helper-wrapped raw numeric parses used in money payloads", () => {
    const source = `
function toNumber(value: string) {
  return Number(value);
}

const payload = {
  price: toNumber(priceInput),
};
`;

    expect(
      collectRawMoneyParsesFromSource(
        "src/components/example/NewProductView.tsx",
        source
      )
    ).toEqual([
      expect.objectContaining({
        file: "src/components/example/NewProductView.tsx",
        lineNumber: 7,
      }),
    ]);
  });

  it("scans every frontend source file for unreviewed raw money parsing", () => {
    expect(collectRawMoneyParses()).toEqual([]);
  });

  it("keeps every reviewed money-boundary exception attached to live code", () => {
    const missingReviewedParses = reviewedRawParses.filter((entry) => {
      return (
        !existsSync(join(webappRoot, entry.file)) ||
        !readWebappFile(entry.file).includes(entry.textIncludes)
      );
    });

    expect(missingReviewedParses).toEqual([]);
  });
});
