import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

async function readRepoFile(filePath: string) {
  return readFile(path.join(ROOT_DIR, filePath), "utf8");
}

describe("VPS QA deploy contract", () => {
  it("noindexes only the walkthrough route family in production and QA", async () => {
    const setupScript = await readRepoFile("scripts/setup-production-vps.sh");

    expect(
      setupScript.match(/location ~ \^\/walkthrough\(\?:\/\|\\\$\) \{/g),
    ).toHaveLength(2);
    expect(
      setupScript.match(/add_header X-Robots-Tag "noindex" always;/g),
    ).toHaveLength(2);
    expect(setupScript).toContain(String.raw`location ~ ^/walkthrough(?:/|\$) {
        add_header X-Robots-Tag "noindex" always;
        # Keep the SPA fallback inside this location. Making /index.html the
        # terminal try_files argument would internally redirect into location /
        # and drop the route-specific response header.
        try_files \$uri /index.html =404;
    }`);
    expect(setupScript).not.toContain(
      String.raw`add_header X-Robots-Tag "noindex" always;
        try_files \$uri /index.html;`,
    );
    expect(setupScript).toContain(String.raw`location ~ ^/walkthrough(?:/|\$) {
        add_header X-Robots-Tag "noindex" always;

        proxy_pass http://127.0.0.1:$ATHENA_QA_PORT;`);
    expect(setupScript).not.toContain(
      'add_header X-Robots-Tag "noindex" always;\n\n    location / {',
    );
  });

  it("configures distinct nginx proxies for Athena QA and storefront QA", async () => {
    const setupScript = await readRepoFile("scripts/setup-production-vps.sh");

    expect(setupScript).toContain(
      'STOREFRONT_QA_HOST="${STOREFRONT_QA_HOST:-qa.wigclub.store}"',
    );
    expect(setupScript).toContain(
      'ATHENA_QA_HOST="${ATHENA_QA_HOST:-athena-qa.wigclub.store}"',
    );
    expect(setupScript).toContain(
      'STOREFRONT_QA_PORT="${STOREFRONT_QA_PORT:-5176}"',
    );
    expect(setupScript).toContain(
      '"https://$STOREFRONT_QA_HOST" "https://$STOREFRONT_QA_HOST";',
    );
    expect(setupScript).toContain("server_name $STOREFRONT_QA_HOST;");
    expect(setupScript).toContain(
      "proxy_pass http://127.0.0.1:$STOREFRONT_QA_PORT;",
    );
    expect(setupScript).toContain("server_name $ATHENA_QA_HOST;");
    expect(setupScript).toContain(
      "proxy_pass http://127.0.0.1:$ATHENA_QA_PORT;",
    );
  });

  it("starts separate PM2 dev servers for Athena QA and storefront QA", async () => {
    const deployScript = await readRepoFile("scripts/deploy-vps.sh");

    expect(deployScript).toContain(
      'ATHENA_QA_PORT="${ATHENA_QA_PORT:-${QA_PORT:-5175}}"',
    );
    expect(deployScript).toContain(
      'STOREFRONT_QA_PORT="${STOREFRONT_QA_PORT:-5176}"',
    );
    expect(deployScript).toContain("deploy_athena_qa()");
    expect(deployScript).toContain("deploy_storefront_qa()");
    expect(deployScript).toContain("configure_storefront_qa_nginx()");
    expect(deployScript).toContain("configure_api_gateway_cors()");
    expect(deployScript).toContain(
      'python3 - "$config_file" "https://$STOREFRONT_QA_HOST"',
    );
    expect(deployScript).toContain("Could not find the nginx CORS origin map.");
    expect(deployScript).toContain("/etc/nginx/conf.d/wigclub.conf");
    expect(deployScript).toContain("nginx -t");
    expect(deployScript).toContain("systemctl reload nginx");
    expect(deployScript).toContain("pm2 delete athena-qa");
    expect(deployScript).toContain("pm2 delete storefront-qa");
    expect(deployScript).toContain("pm2 start bun --name athena-qa");
    expect(deployScript).toContain("pm2 start bun --name storefront-qa");
    expect(deployScript).toContain(
      'PROD_API_URL="${PROD_API_URL:-https://api.wigclub.store}"',
    );
    expect(deployScript).toContain("VITE_API_URL=$PROD_API_URL");
    expect(deployScript).not.toContain("VITE_API_URL=$PROD_CONVEX_SITE");
    expect(deployScript).toContain(
      'DEV_API_URL="${DEV_API_URL:-https://dev.wigclub.store}"',
    );
    expect(deployScript).toContain(
      'remote_script "$REMOTE_SOURCE_DIR" "$STOREFRONT_QA_PORT" "$DEV_API_URL" "$STOREFRONT_QA_HOST"',
    );
    expect(deployScript).toContain('DEV_API_URL="$3"');
    expect(deployScript).toContain('VITE_API_URL="$DEV_API_URL"');
    expect(deployScript).not.toContain('VITE_API_URL="$DEV_CONVEX_SITE"');
    expect(deployScript).toContain('STOREFRONT_QA_HOST="$STOREFRONT_QA_HOST"');
    expect(deployScript).not.toContain('VITE_STOREFRONT_URL="$STOREFRONT_URL"');
    expect(deployScript).toContain(
      'VITE_WALKTHROUGH_PRIVACY_CONTACT="$VITE_WALKTHROUGH_PRIVACY_CONTACT"',
    );
  });

  it("validates and propagates the optional walkthrough privacy contact", async () => {
    const deployScript = await readRepoFile("scripts/deploy-vps.sh");

    expect(deployScript).toContain("validate_walkthrough_privacy_contact()");
    expect(deployScript).toContain(
      "VITE_WALKTHROUGH_PRIVACY_CONTACT must be empty or a valid email address.",
    );
    expect(deployScript.match(/VITE_WALKTHROUGH_PRIVACY_CONTACT=\$VITE_WALKTHROUGH_PRIVACY_CONTACT/g))
      .toHaveLength(2);
    expect(deployScript).toContain(
      'remote_script "$REMOTE_SOURCE_DIR" "$ATHENA_QA_PORT" "$DEV_CONVEX_CLOUD" "$DEV_CONVEX_SITE" "$ATHENA_QA_HOST" "$VITE_WALKTHROUGH_PRIVACY_CONTACT"',
    );
  });

  it("rejects shell metacharacters before any deployment command can run", () => {
    const marker = `/tmp/athena-deploy-injection-${process.pid}`;
    rmSync(marker, { force: true });

    const result = spawnSync("bash", ["scripts/deploy-vps.sh", "status"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      env: {
        ...process.env,
        VITE_WALKTHROUGH_PRIVACY_CONTACT: `owner@example.com;touch${marker}`,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "VITE_WALKTHROUGH_PRIVACY_CONTACT must be empty or a valid email address.",
    );
    expect(existsSync(marker)).toBe(false);
  });

  it("can build production static apps locally before uploading to the VPS", async () => {
    const deployScript = await readRepoFile("scripts/deploy-vps.sh");
    const interactiveScript = await readRepoFile("manage-athena-versions.sh");
    const runbook = await readRepoFile("docs/deployment/vps-production.md");

    expect(deployScript).toContain("athena-local");
    expect(deployScript).toContain("storefront-local");
    expect(deployScript).toContain("convex-athena-local");
    expect(deployScript).toContain("convex-storefront-local");
    expect(deployScript).toContain("full-prod-local");
    expect(deployScript).toContain("build_static_app_locally()");
    expect(deployScript).toContain("deploy_static_app_local()");
    expect(deployScript).not.toContain("eval ");
    expect(deployScript).toContain('env "${BUILD_ENV[@]}" bun run build');
    expect(deployScript).toContain('env "${build_env[@]}" bun run build');
    expect(deployScript).toContain(
      'export VITE_ATHENA_WEBAPP_VERSION="$fun_name ($timestamp)"',
    );
    expect(deployScript).toContain('export VITE_ATHENA_WEBAPP_BUILD_SHA="$git_sha"');
    expect(deployScript).toContain(
      'build_static_app_locally "$package_dir" "$env_script" "$fun_name ($version)" "$git_sha"',
    );
    expect(deployScript).toContain(
      'rsync -a --delete "$package_dir/dist/" "$REMOTE:$version_path/"',
    );
    expect(deployScript).toContain('"built_on": "local"');
    expect(deployScript).toContain("deploy_athena_local");
    expect(deployScript).toContain("deploy_storefront_local");
    expect(deployScript).toMatch(/athena\)\s+deploy_athena_local/);
    expect(deployScript).toMatch(
      /convex-athena-local\)\s+deploy_convex_prod[\s\S]*deploy_athena_local[\s\S]*;;/,
    );
    expect(deployScript).toMatch(
      /convex-storefront-local\)\s+deploy_convex_prod[\s\S]*deploy_storefront_local[\s\S]*;;/,
    );
    expect(deployScript).toMatch(
      /full-prod\)\s+require_remote_source[\s\S]*deploy_athena_local[\s\S]*deploy_storefront_local/,
    );
    expect(deployScript).toContain("athena-remote");
    expect(interactiveScript).toContain("athena-webapp local build");
    expect(interactiveScript).toContain("storefront local build");
    expect(interactiveScript).toContain("convex + athena local build");
    expect(interactiveScript).toContain("convex + storefront local build");
    expect(interactiveScript).toContain("full-deploy local builds");
    expect(interactiveScript).toContain("deploy_vps athena-local");
    expect(interactiveScript).toContain("deploy_vps storefront-local");
    expect(interactiveScript).toContain("deploy_vps convex-athena-local");
    expect(interactiveScript).toContain("deploy_vps convex-storefront-local");
    expect(interactiveScript).toContain("deploy_vps full-prod-local");
    expect(runbook).toContain("scripts/deploy-vps.sh athena-local");
    expect(runbook).toContain("scripts/deploy-vps.sh storefront-local");
    expect(runbook).toContain("scripts/deploy-vps.sh convex-athena-local");
    expect(runbook).toContain("scripts/deploy-vps.sh convex-storefront-local");
    expect(runbook).toContain("scripts/deploy-vps.sh full-prod-local");
  });

  it("deploys storefront QA only for storefront changes and both QA surfaces for shared deploy changes", async () => {
    const workflow = await readRepoFile(
      ".github/workflows/athena-qa-deploy.yml",
    );

    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("github.event.before");
    expect(workflow).toContain("github.sha");
    expect(workflow).toContain("packages/storefront-webapp/");
    expect(workflow).toContain('echo "storefront=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "athena=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "shared=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("scripts/deploy-vps.sh qa-storefront");
    expect(workflow).toContain("scripts/deploy-vps.sh qa-athena");
    expect(workflow).toContain("Host: qa.wigclub.store");
    expect(workflow).toContain("Host: athena-qa.wigclub.store");
    expect(workflow).toContain("%{http_code}");
    expect(workflow).toContain("<title>Wigclub</title>");
    expect(workflow).toContain("/src/main.tsx");
  });

  it("resets generated remote checkout drift before switching deploy refs", async () => {
    const deployScript = await readRepoFile("scripts/deploy-vps.sh");

    expect(deployScript).toContain(
      "Discarding local changes in %s before checking out %s.",
    );
    expect(deployScript).toMatch(
      /git reset --hard[\s\S]*git fetch --prune origin[\s\S]*git checkout --detach "\$DEPLOY_REF"/,
    );
  });

  it("schedules browser-level Athena QA smoke checks", async () => {
    const workflow = await readRepoFile(
      ".github/workflows/athena-qa-smoke.yml",
    );

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("- cron:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("run: bun install --frozen-lockfile");
    expect(workflow).toContain("run: bunx playwright install chromium");
    expect(workflow).toContain(
      "ATHENA_QA_URL: https://athena-qa.wigclub.store/",
    );
    expect(workflow).toContain(
      "run: bun run harness:behavior --scenario athena-qa-live-smoke --record-video",
    );
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("artifacts/harness-behavior");
  });
});
