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

function createStorefrontSnippetLinter() {
  return createSnippetLinter(
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

  it("blocks storefront files from importing the Athena webapp package", async () => {
    const eslint = createStorefrontSnippetLinter();

    const [appRoot] = await eslint.lintText(
      `import { OnlineOrder } from "@athena/webapp";`,
      {
        filePath: "packages/storefront-webapp/src/components/checkout/utils.ts",
      },
    );

    expect(appRoot.messages).toHaveLength(1);
    expect(appRoot.messages[0]?.message).toContain(
      "Storefront code must not import the Athena webapp package",
    );

    const [subpath] = await eslint.lintText(
      `import { defineSurfaceContext } from "@athena/webapp/shared/intelligence";`,
      { filePath: "packages/storefront-webapp/src/api/trackingEvents.ts" },
    );

    expect(subpath.messages).toHaveLength(1);
    expect(subpath.messages[0]?.message).toContain("@athena/contracts");
  });

  it("blocks storefront files from reaching into athena-webapp by relative path", async () => {
    const eslint = createStorefrontSnippetLinter();

    const [result] = await eslint.lintText(
      `import { Id } from "../../../athena-webapp/convex/_generated/dataModel";`,
      { filePath: "packages/storefront-webapp/src/contexts/StoreContext.tsx" },
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toContain(
      "reach into it by relative path",
    );
  });

  it("allows storefront files to import the neutral contract package", async () => {
    const eslint = createStorefrontSnippetLinter();

    const [barrel] = await eslint.lintText(
      `import { Id, Store, StoreFrontUser } from "@athena/contracts";`,
      { filePath: "packages/storefront-webapp/src/contexts/StoreContext.tsx" },
    );

    expect(barrel.messages).toEqual([]);

    const [subpath] = await eslint.lintText(
      `import { sortHomepageRankedItems } from "@athena/contracts/homepageRanking";`,
      {
        filePath: "packages/storefront-webapp/src/components/home/homePageContent.ts",
      },
    );

    expect(subpath.messages).toEqual([]);
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
