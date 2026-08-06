import { readFileSync } from "node:fs";
import path from "node:path";

type Manifest = {
  packageManager?: string;
};

type BunVersionCheckOptions = {
  installedVersion?: string;
  logger?: Pick<Console, "log">;
};

const PACKAGE_MANAGER_PATTERN = /^bun@([0-9]+\.[0-9]+\.[0-9]+)$/;

export function pinnedBunVersion(rootDir: string): string {
  const manifestPath = path.join(rootDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const pin = manifest.packageManager;
  const match = pin ? PACKAGE_MANAGER_PATTERN.exec(pin) : null;

  if (!match) {
    throw new Error(
      `package.json "packageManager" must pin an exact bun version (e.g. "bun@1.1.29"), got ${JSON.stringify(pin)}.`
    );
  }

  return match[1];
}

export function runBunVersionCheck(
  rootDir: string,
  options: BunVersionCheckOptions = {}
) {
  const pinned = pinnedBunVersion(rootDir);
  const installed = options.installedVersion ?? Bun.version;
  const logger = options.logger ?? console;

  if (installed !== pinned) {
    throw new Error(
      `Installed bun ${installed} does not match the packageManager pin bun@${pinned} in package.json.\n` +
        "A newer bun can rewrite bun.lockb into a format the pinned CI bun can't parse " +
        '("error parsing lockfile: Outdated lockfile version"), which fails CI after the gate ' +
        "already passed locally.\n" +
        `Install bun@${pinned} (e.g. \`curl -fsSL https://bun.sh/install | bash -s "bun-v${pinned}"\`) ` +
        "before running bun install or the pr:athena gate, or bump the packageManager pin " +
        "deliberately if the upgrade is intentional."
    );
  }

  logger.log(`bun version check passed: installed bun ${installed} matches the packageManager pin.`);
}

if (import.meta.main) {
  try {
    runBunVersionCheck(path.resolve(import.meta.dirname, ".."));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
