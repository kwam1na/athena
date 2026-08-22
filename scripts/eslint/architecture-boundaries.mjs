const ATHENA_LOWER_LAYER_FILES = [
  "src/components/**/*.{ts,tsx}",
  "src/contexts/**/*.{ts,tsx}",
  "src/hooks/**/*.{ts,tsx}",
  "src/lib/**/*.{ts,tsx}",
  "src/settings/**/*.{ts,tsx}",
  "src/stores/**/*.{ts,tsx}",
];

const STOREFRONT_LOWER_LAYER_FILES = [
  "src/api/auth.ts",
  "src/api/analytics.ts",
  "src/api/bag.ts",
  "src/api/checkoutSession.ts",
  "src/api/onlineOrder.ts",
  "src/api/rewards.ts",
  "src/api/savedBag.ts",
  "src/api/storeFrontUser.ts",
  "src/components/auth/**/*.{ts,tsx}",
  "src/components/checkout/**/*.{ts,tsx}",
  "src/components/states/checkout-expired/**/*.{ts,tsx}",
  "src/contexts/StoreContext.tsx",
  "src/hooks/useGetActiveCheckoutSession.tsx",
  "src/hooks/useShoppingBag.ts",
  "src/hooks/useStorefrontObservability.ts",
  "src/lib/constants.ts",
  "src/lib/queries/checkout.ts",
  "src/lib/storefrontFailureObservability.ts",
  "src/lib/storefrontJourneyEvents.ts",
  "src/lib/utils.ts",
];

const STOREFRONT_PACKAGE_BOUNDARY_FILES = ["src/**/*.{ts,tsx}"];

// The storefront reads shared DTOs from the neutral `@athena/contracts`
// package, never from the Athena admin application root or its generated Convex
// output. See packages/athena-contracts/README.md.
const ATHENA_APP_ROOT_SPECIFIERS = [
  "@athena/webapp",
  "@athena/webapp/**",
];

const ATHENA_PACKAGE_RELATIVE_SPECIFIERS = [
  "**/athena-webapp",
  "**/athena-webapp/**",
];

const TEST_FILE_IGNORES = ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"];

const ATHENA_ROUTE_ENTRYPOINTS = expandImportEntrypoint("routes/_authed");
const ATHENA_SHELL_ENTRYPOINTS = [
  ...expandImportEntrypoint("components/app-sidebar"),
  ...expandImportEntrypoint("components/ui/modals/organization-modal"),
  ...expandImportEntrypoint("components/ui/modals/store-modal"),
];

const STOREFRONT_ROUTE_ENTRYPOINTS = [
  ...expandImportEntrypoint("routes/shop/checkout"),
  ...expandImportEntrypoint("routes/login"),
  ...expandImportEntrypoint("routes/signup"),
  ...expandImportEntrypoint("routes/auth.verify"),
];

export function createAthenaArchitectureBoundaryConfig(options = {}) {
  return [
    {
      name: "athena-architecture-boundaries",
      files: prefixGlobs(ATHENA_LOWER_LAYER_FILES, options.packagePrefix),
      ignores: TEST_FILE_IGNORES,
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ATHENA_ROUTE_ENTRYPOINTS,
                message:
                  "Athena admin/store lower-layer files must not import route entrypoints under src/routes/_authed. Keep the dependency direction route -> lower layer, not lower layer -> route.",
              },
              {
                group: ATHENA_SHELL_ENTRYPOINTS,
                message:
                  "Athena admin/store lower-layer files must not import auth-shell entrypoints like AppSidebar, StoreModal, or OrganizationModal. Keep the shell depending on lower layers, not the reverse.",
              },
            ],
          },
        ],
      },
    },
  ];
}

const STOREFRONT_PACKAGE_BOUNDARY_PATTERN = {
  group: [...ATHENA_APP_ROOT_SPECIFIERS, ...ATHENA_PACKAGE_RELATIVE_SPECIFIERS],
  message:
    "Storefront code must not import the Athena webapp package or reach into it by relative path. Shared DTOs and browser-safe contracts live in @athena/contracts (packages/athena-contracts); add a contract there instead.",
};

const STOREFRONT_ROUTE_ENTRYPOINT_PATTERN = {
  group: STOREFRONT_ROUTE_ENTRYPOINTS,
  message:
    "Storefront checkout/auth lower-layer files must not import checkout or auth route entrypoints under src/routes/shop/checkout, src/routes/login.tsx, src/routes/signup.tsx, or src/routes/auth.verify.tsx. Keep the dependency direction route -> lower layer, not lower layer -> route.",
};

export function createStorefrontArchitectureBoundaryConfig(options = {}) {
  // ESLint merges `no-restricted-imports` by last-config-wins rather than by
  // union, so any config that also matches a lower-layer file has to carry the
  // lower-layer patterns too. The package boundary comes first and applies to
  // every storefront source file; the narrower lower-layer config restates it.
  return [
    {
      name: "storefront-package-boundaries",
      files: prefixGlobs(
        STOREFRONT_PACKAGE_BOUNDARY_FILES,
        options.packagePrefix,
      ),
      rules: {
        "no-restricted-imports": [
          "error",
          { patterns: [STOREFRONT_PACKAGE_BOUNDARY_PATTERN] },
        ],
      },
    },
    {
      name: "storefront-architecture-boundaries",
      files: prefixGlobs(STOREFRONT_LOWER_LAYER_FILES, options.packagePrefix),
      ignores: TEST_FILE_IGNORES,
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              STOREFRONT_PACKAGE_BOUNDARY_PATTERN,
              STOREFRONT_ROUTE_ENTRYPOINT_PATTERN,
            ],
          },
        ],
      },
    },
  ];
}

export function getAthenaArchitectureBoundaryTargets() {
  return [...ATHENA_LOWER_LAYER_FILES];
}

export function getStorefrontArchitectureBoundaryTargets() {
  return [...STOREFRONT_LOWER_LAYER_FILES, ...STOREFRONT_PACKAGE_BOUNDARY_FILES];
}

function expandImportEntrypoint(pathFragment) {
  return [
    `**/${pathFragment}`,
    `**/${pathFragment}.*`,
    `**/${pathFragment}/**`,
  ];
}

function prefixGlobs(globs, packagePrefix = "") {
  if (!packagePrefix) {
    return [...globs];
  }

  return globs.map((glob) => `${packagePrefix}${glob}`);
}
