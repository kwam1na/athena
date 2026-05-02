import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

async function readRepoFile(filePath: string) {
  return readFile(path.join(ROOT_DIR, filePath), "utf8");
}

describe("VPS QA deploy contract", () => {
  it("configures distinct nginx proxies for Athena QA and storefront QA", async () => {
    const setupScript = await readRepoFile("scripts/setup-production-vps.sh");

    expect(setupScript).toContain('STOREFRONT_QA_HOST="${STOREFRONT_QA_HOST:-qa.wigclub.store}"');
    expect(setupScript).toContain('ATHENA_QA_HOST="${ATHENA_QA_HOST:-athena-qa.wigclub.store}"');
    expect(setupScript).toContain('STOREFRONT_QA_PORT="${STOREFRONT_QA_PORT:-5176}"');
    expect(setupScript).toContain("server_name $STOREFRONT_QA_HOST;");
    expect(setupScript).toContain("proxy_pass http://127.0.0.1:$STOREFRONT_QA_PORT;");
    expect(setupScript).toContain("server_name $ATHENA_QA_HOST;");
    expect(setupScript).toContain("proxy_pass http://127.0.0.1:$ATHENA_QA_PORT;");
  });

  it("starts separate PM2 dev servers for Athena QA and storefront QA", async () => {
    const deployScript = await readRepoFile("scripts/deploy-vps.sh");

    expect(deployScript).toContain('ATHENA_QA_PORT="${ATHENA_QA_PORT:-${QA_PORT:-5175}}"');
    expect(deployScript).toContain('STOREFRONT_QA_PORT="${STOREFRONT_QA_PORT:-5176}"');
    expect(deployScript).toContain("deploy_athena_qa()");
    expect(deployScript).toContain("deploy_storefront_qa()");
    expect(deployScript).toContain("pm2 delete athena-qa");
    expect(deployScript).toContain("pm2 delete storefront-qa");
    expect(deployScript).toContain("pm2 start bun --name athena-qa");
    expect(deployScript).toContain("pm2 start bun --name storefront-qa");
    expect(deployScript).toContain('VITE_API_URL="$DEV_CONVEX_SITE"');
  });

  it("deploys storefront QA only for storefront changes and both QA surfaces for shared deploy changes", async () => {
    const workflow = await readRepoFile(".github/workflows/athena-qa-deploy.yml");

    expect(workflow).toContain("packages/storefront-webapp/");
    expect(workflow).toContain('echo "storefront=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "athena=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "shared=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("scripts/deploy-vps.sh qa-storefront");
    expect(workflow).toContain("scripts/deploy-vps.sh qa-athena");
    expect(workflow).toContain('Host: qa.wigclub.store');
    expect(workflow).toContain('Host: athena-qa.wigclub.store');
  });
});
