// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  checkDesignSystemLine,
  countWholeTreeDesignSystemDrift,
  getDesignSystemPolicyExceptions,
  RESIDUAL_DRIFT_BASELINE,
} from "../../scripts/design-system-policy";
import { execFileSync } from "node:child_process";

describe("storefront design-system policy", () => {
  it.each([
    ["raw hex", 'const className = "text-[#ff1493]"', "raw-hex"],
    ["raw status hue", 'const className = "text-red-600"', "raw-status-hue"],
    [
      "arbitrary layout value",
      'const className = "max-w-[1024px]"',
      "arbitrary-value",
    ],
    [
      "legacy accent alias",
      'const className = "text-accent2"',
      "legacy-alias",
    ],
  ])("rejects a newly introduced %s", (_label, line, rule) => {
    expect(checkDesignSystemLine("src/components/Example.tsx", line)).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule })]),
    );
  });

  it("accepts semantic tokens and named layout utilities", () => {
    expect(
      checkDesignSystemLine(
        "src/components/Example.tsx",
        'const className = "text-danger max-w-storefront"',
      ),
    ).toEqual([]);
  });

  it("keeps foundation authority outside changed-feature enforcement", () => {
    expect(
      checkDesignSystemLine(
        "src/index.css",
        "--color-danger: #b42318; width: 1024px;",
      ),
    ).toEqual([]);
  });

  it("allows only the documented receipt print geometry exception", () => {
    const receiptPath = "src/routes/shop/receipt/-PosReceiptPage.tsx";

    expect(
      checkDesignSystemLine(
        receiptPath,
        'const className = "print:w-[80mm]"',
      ),
    ).toEqual([]);
    expect(
      checkDesignSystemLine(receiptPath, 'const className = "text-red-600"'),
    ).toEqual([expect.objectContaining({ rule: "raw-status-hue" })]);
    expect(getDesignSystemPolicyExceptions()).toEqual([
      expect.objectContaining({
        path: receiptPath,
        rules: ["arbitrary-value"],
        reason: expect.stringContaining("print"),
      }),
    ]);
  });

  it("keeps whole-tree residual drift at or below the reviewed baseline", () => {
    const paths = execFileSync("git", ["ls-files", "src"], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter((path) => /\.(?:css|ts|tsx)$/.test(path));
    const counts = countWholeTreeDesignSystemDrift(paths);

    for (const rule of Object.keys(
      RESIDUAL_DRIFT_BASELINE,
    ) as Array<keyof typeof RESIDUAL_DRIFT_BASELINE>) {
      expect(counts[rule], rule).toBeLessThanOrEqual(
        RESIDUAL_DRIFT_BASELINE[rule],
      );
    }
  });
});
