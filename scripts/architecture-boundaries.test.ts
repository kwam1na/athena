import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import {
  createAthenaArchitectureBoundaryConfig,
  createStorefrontArchitectureBoundaryConfig,
} from "./eslint/architecture-boundaries.mjs";

function createSnippetLinter(config: ReturnType<typeof tseslint.config>) {
  return new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    overrideConfig: config,
  });
}

describe("architecture boundary eslint config", () => {
  it("allows athena route entrypoints to import lower-layer modules", async () => {
    const eslint = createSnippetLinter(
      tseslint.config(
        {
          files: ["packages/athena-webapp/**/*.{ts,tsx}"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
              ecmaVersion: 2020,
              sourceType: "module",
              ecmaFeatures: { jsx: true },
            },
          },
        },
        ...createAthenaArchitectureBoundaryConfig({
          packagePrefix: "packages/athena-webapp/",
        }),
      ),
    );

    const [result] = await eslint.lintText(
      `import { AppSidebar } from "@/components/app-sidebar";`,
      {
        filePath: "packages/athena-webapp/src/routes/_authed.tsx",
      },
    );

    expect(result.messages).toEqual([]);
  });

  it("blocks athena lower-layer files from importing _authed route entrypoints", async () => {
    const eslint = createSnippetLinter(
      tseslint.config(
        {
          files: ["packages/athena-webapp/**/*.{ts,tsx}"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
              ecmaVersion: 2020,
              sourceType: "module",
              ecmaFeatures: { jsx: true },
            },
          },
        },
        ...createAthenaArchitectureBoundaryConfig({
          packagePrefix: "packages/athena-webapp/",
        }),
      ),
    );

    const [result] = await eslint.lintText(
      `import { Route } from "@/routes/_authed";`,
      {
        filePath:
          "packages/athena-webapp/src/components/orders/OrderView.tsx",
      },
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toContain(
      "Athena admin/store lower-layer files must not import route entrypoints",
    );
    expect(result.messages[0]?.message).toContain("src/routes/_authed");
  });

  it("blocks storefront checkout lower layers from importing checkout route files", async () => {
    const eslint = createSnippetLinter(
      tseslint.config(
        {
          files: ["packages/storefront-webapp/**/*.{ts,tsx}"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
              ecmaVersion: 2020,
              sourceType: "module",
              ecmaFeatures: { jsx: true },
            },
          },
        },
        ...createStorefrontArchitectureBoundaryConfig({
          packagePrefix: "packages/storefront-webapp/",
        }),
      ),
    );

    const [result] = await eslint.lintText(
      `import { Route } from "@/routes/shop/checkout/index";`,
      {
        filePath:
          "packages/storefront-webapp/src/components/checkout/CheckoutProvider.tsx",
      },
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toContain(
      "Storefront checkout/auth lower-layer files must not import checkout or auth route entrypoints",
    );
    expect(result.messages[0]?.message).toContain("src/routes/shop/checkout");
  });

  it("does not apply the storefront rule to unrelated files outside the scoped hot paths", async () => {
    const eslint = createSnippetLinter(
      tseslint.config(
        {
          files: ["packages/storefront-webapp/**/*.{ts,tsx}"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
              ecmaVersion: 2020,
              sourceType: "module",
              ecmaFeatures: { jsx: true },
            },
          },
        },
        ...createStorefrontArchitectureBoundaryConfig({
          packagePrefix: "packages/storefront-webapp/",
        }),
      ),
    );

    const [result] = await eslint.lintText(
      `import { Route } from "@/routes/login";`,
      {
        filePath: "packages/storefront-webapp/src/components/ui/button.tsx",
      },
    );

    expect(result.messages).toEqual([]);
  });
});
