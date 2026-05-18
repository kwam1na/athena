import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

type PlanHtmlFinding = {
  filePath: string;
  message: string;
};

const PLAN_HTML_DIR = "docs/plans";

function normalizeRepoPath(filePath: string) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

async function collectDefaultPlanHtmlFiles(rootDir: string) {
  const entries = await readdir(path.join(rootDir, PLAN_HTML_DIR), {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(PLAN_HTML_DIR, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function hasRemoteReference(value: string) {
  return /^https?:\/\//i.test(value) || /^\/\//.test(value);
}

export async function collectPlanHtmlFindings(
  rootDir: string,
  filePaths: string[],
) {
  const findings: PlanHtmlFinding[] = [];

  for (const repoPath of filePaths.map(normalizeRepoPath)) {
    const absolutePath = path.join(rootDir, repoPath);
    const html = await readFile(absolutePath, "utf8");
    const parseErrors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => {
      parseErrors.push(error.message);
    });

    const dom = new JSDOM(html, {
      contentType: "text/html",
      includeNodeLocations: true,
      url: `file://${absolutePath}`,
      virtualConsole,
    });
    const document = dom.window.document;

    for (const parseError of parseErrors) {
      findings.push({
        filePath: repoPath,
        message: `HTML parser reported: ${parseError}`,
      });
    }

    if (!/^<!doctype html>/i.test(html.trimStart())) {
      findings.push({
        filePath: repoPath,
        message: "Use the HTML5 doctype: <!doctype html>.",
      });
    }

    const hasCharsetMeta = Boolean(
      document.querySelector('meta[charset="utf-8" i]') ??
        document.querySelector(
          'meta[http-equiv="Content-Type" i][content*="charset=utf-8" i]',
        ),
    );
    if (!hasCharsetMeta) {
      findings.push({
        filePath: repoPath,
        message: 'Include a UTF-8 charset meta tag, preferably <meta charset="utf-8">.',
      });
    }

    if (!document.title.trim()) {
      findings.push({
        filePath: repoPath,
        message: "Include a non-empty <title>.",
      });
    }

    if (!document.body?.textContent?.trim()) {
      findings.push({
        filePath: repoPath,
        message: "The HTML artifact body is empty.",
      });
    }

    if (document.querySelector("script")) {
      findings.push({
        filePath: repoPath,
        message: "Plan HTML artifacts must not include JavaScript.",
      });
    }

    for (const element of Array.from(
      document.querySelectorAll("[src], link[href]"),
    )) {
      const reference =
        element.getAttribute("src") ?? element.getAttribute("href");
      if (reference && hasRemoteReference(reference)) {
        findings.push({
          filePath: repoPath,
          message: `Plan HTML artifacts must not reference remote assets: ${reference}`,
        });
      }
    }
  }

  return findings;
}

export async function runPlanHtmlValidation(rootDir: string, args: string[]) {
  const filePaths =
    args.length > 0 ? args : await collectDefaultPlanHtmlFiles(rootDir);
  const findings = await collectPlanHtmlFindings(rootDir, filePaths);

  if (findings.length === 0) {
    console.log(
      `[plan html check] Validated ${filePaths.length} HTML review artifact(s).`,
    );
    return;
  }

  throw new Error(
    [
      "[plan html check] HTML review artifact validation failed:",
      ...findings.map((finding) => `- ${finding.filePath}: ${finding.message}`),
    ].join("\n"),
  );
}

if (import.meta.main) {
  runPlanHtmlValidation(process.cwd(), process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
