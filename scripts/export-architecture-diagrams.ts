import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Page } from "playwright";

import {
  DIAGRAMS,
  bundleFileName,
  parseExportOptions,
  type DiagramDefinition,
  type DiagramProfile,
  type DiagramTheme,
} from "./architecture-diagram-config";

const SCALE = 2;
const repoRoot = resolve(import.meta.dirname, "..");
const defaultOutputDirectory = resolve(repoRoot, "docs/architecture/assets");
const options = parseExportOptions(Bun.argv.slice(2));
const outputDirectory = options.bundleDirectory
  ? resolve(process.cwd(), options.bundleDirectory)
  : defaultOutputDirectory;

type ManifestAsset = {
  diagramId: string;
  file: string;
  height: number;
  profile: DiagramProfile;
  sha256: string;
  source: string;
  theme: DiagramTheme;
  width: number;
};

const setRenderProfile = async (
  page: Page,
  profile: DiagramProfile,
  theme: DiagramTheme,
) => {
  await page.evaluate(
    ({ nextProfile, nextTheme }) => {
      document.documentElement.dataset.diagramProfile = nextProfile;
      document.documentElement.dataset.theme = nextTheme;
    },
    { nextProfile: profile, nextTheme: theme },
  );
  await page.evaluate(() => document.fonts.ready);
};

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const manifestAssets: ManifestAsset[] = [];

try {
  const sourceGroups = Map.groupBy(DIAGRAMS, (diagram) => diagram.source);

  for (const [sourceName, diagrams] of sourceGroups) {
    const page = await browser.newPage({
      deviceScaleFactor: SCALE,
      viewport: { width: 1440, height: 1000 },
    });

    try {
      const sourcePath = resolve(repoRoot, "docs/architecture", sourceName);
      await page.goto(pathToFileURL(sourcePath).href);

      const renderedDiagrams = page.locator("svg");
      const count = await renderedDiagrams.count();
      const expectedCount = Math.max(...diagrams.map(({ index }) => index)) + 1;
      if (count !== expectedCount) {
        throw new Error(
          `${sourceName}: expected ${expectedCount} diagrams, found ${count}`,
        );
      }

      for (const theme of options.themes) {
        await setRenderProfile(page, options.profile, theme);

        for (const diagram of diagrams) {
          const outputName = options.bundleDirectory
            ? bundleFileName(diagram, theme)
            : outputNameForLegacyExport(diagram, theme);
          const screenshot = await renderedDiagrams.nth(diagram.index).screenshot();
          const outputPath = resolve(outputDirectory, outputName);
          await writeFile(outputPath, screenshot);

          if (options.bundleDirectory) {
            const bounds = await renderedDiagrams.nth(diagram.index).boundingBox();
            if (!bounds) {
              throw new Error(`${diagram.id}: could not measure rendered diagram`);
            }
            manifestAssets.push({
              diagramId: diagram.id,
              file: outputName,
              height: Math.round(bounds.height * SCALE),
              profile: options.profile,
              sha256: createHash("sha256").update(screenshot).digest("hex"),
              source: diagram.source,
              theme,
              width: Math.round(bounds.width * SCALE),
            });
          }
        }
      }
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (options.bundleDirectory) {
  const manifest = {
    schemaVersion: 1,
    profile: options.profile,
    scale: SCALE,
    assets: manifestAssets,
  };
  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

console.log(
  `Exported ${manifestAssets.length || DIAGRAMS.length * options.themes.length} architecture diagrams to ${outputDirectory}`,
);

function outputNameForLegacyExport(
  diagram: DiagramDefinition,
  theme: DiagramTheme,
) {
  if (theme === "light") {
    return diagram.legacyOutput;
  }
  return bundleFileName(diagram, theme);
}
