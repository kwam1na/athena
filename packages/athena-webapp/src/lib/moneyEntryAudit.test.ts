import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type ReviewedRawParse = {
  file: string;
  reason: string;
  lineIncludes: string;
};

const auditedFiles = [
  "src/components/add-product/ProductView.tsx",
  "src/components/add-product/ProductStock.tsx",
  "src/components/cash-controls/RegisterCloseoutView.tsx",
  "src/components/cash-controls/RegisterSessionView.tsx",
  "src/components/orders/ReturnExchangeView.tsx",
  "src/components/promo-codes/PromoCodePreview.tsx",
  "src/components/promo-codes/PromoCodeView.tsx",
  "src/components/services/ServiceCatalogView.tsx",
  "src/components/services/ServiceCasesView.tsx",
  "src/components/services/ServiceIntakeView.tsx",
  "src/components/store-configuration/components/FeesView.tsx",
  "src/components/store-configuration/components/TaxView.tsx",
];

const reviewedRawParses: ReviewedRawParse[] = [
  {
    file: "src/components/cash-controls/RegisterSessionView.tsx",
    lineIncludes: "const parsedAmount = Number(amount);",
    reason: "Backend-owned conversion boundary: cash deposit mutation converts display amount with toPesewas.",
  },
  {
    file: "src/components/promo-codes/PromoCodePreview.tsx",
    lineIncludes: "Number.parseFloat(discount)",
    reason: "Display-only preview formatting. V26-369 covers mutation persistence.",
  },
];

const nonMoneyNumericParses = [
  "durationMinutes",
  "inventoryForm.quantity",
  "lineItemForm.quantity",
  "setTaxRate(parseFloat(e.target.value)",
];

function readWebappFile(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

function isRawNumericParse(line: string): boolean {
  return /\b(Number|parseFloat|parseInt)\s*\(/.test(line);
}

function referencesMoney(line: string): boolean {
  return /\b(amount|balance|cash|cost|deposit|discount|fee|payment|price)\b/i.test(line);
}

function reviewedReason(file: string, line: string): string | undefined {
  return reviewedRawParses.find(
    (entry) => entry.file === file && line.includes(entry.lineIncludes)
  )?.reason;
}

function allowedNonMoneyParse(line: string): boolean {
  return nonMoneyNumericParses.some((allowed) => line.includes(allowed));
}

describe("money entry audit", () => {
  it("keeps raw numeric parsing at money-entry boundaries reviewed", () => {
    const unreviewedParses = auditedFiles.flatMap((file) => {
      return readWebappFile(file)
        .split("\n")
        .map((line, index) => ({
          file,
          line: line.trim(),
          lineNumber: index + 1,
        }))
        .filter(({ line }) => isRawNumericParse(line))
        .filter(({ line }) => referencesMoney(line))
        .filter(({ line }) => !allowedNonMoneyParse(line))
        .filter(({ file, line }) => reviewedReason(file, line) === undefined);
    });

    expect(unreviewedParses).toEqual([]);
  });

  it("keeps every reviewed money-boundary exception attached to live code", () => {
    const missingReviewedParses = reviewedRawParses.filter((entry) => {
      return !readWebappFile(entry.file).includes(entry.lineIncludes);
    });

    expect(missingReviewedParses).toEqual([]);
  });
});
