import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GRAPHIFY_WIKI_ARTIFACTS } from "./graphify-wiki";
import {
  TRACKED_CONVEX_GENERATED_ARTIFACTS,
  TRACKED_GENERATED_HARNESS_DOCS,
  TRACKED_GRAPHIFY_ARTIFACTS,
  runPreCommitGeneratedArtifacts,
} from "./pre-commit-generated-artifacts";

async function withTempRepo<T>(callback: (repoDir: string) => Promise<T>) {
  const repoDir = await mkdtemp(path.join(tmpdir(), "athena-pre-commit-"));

  try {
    return await callback(repoDir);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

async function writeConvexApiFixture(
  repoDir: string,
  apiSource = 'import type * as catalog_items from "../catalog/items.js";\n'
) {
  const convexDir = path.join(
    repoDir,
    "packages",
    "athena-webapp",
    "convex"
  );
  await mkdir(path.join(convexDir, "catalog"), { recursive: true });
  await mkdir(path.join(convexDir, "_generated"), { recursive: true });
  await writeFile(
    path.join(convexDir, "convex.config.ts"),
    'import { defineApp } from "convex/server";\nexport default defineApp();\n'
  );
  await writeFile(path.join(convexDir, "catalog", "items.ts"), "export {};\n");
  await writeFile(
    path.join(convexDir, "catalog", "items.test.ts"),
    "export {};\n"
  );
  await writeFile(path.join(convexDir, "_generated", "api.d.ts"), apiSource);
  await writeFile(
    path.join(repoDir, "packages", "athena-webapp", ".env.local"),
    "VITE_CONVEX_URL=https://jovial-wildebeest-179.convex.cloud\n"
  );
}

describe("runPreCommitGeneratedArtifacts", () => {
  it("regenerates harness docs and graphify artifacts before staging tracked outputs", async () => {
    const steps: string[] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {
        steps.push("harness:generate");
      },
      hasConvexSourceChanges: async () => {
        steps.push("convex:changed?");
        return true;
      },
      refreshConvexGeneratedApi: async () => {
        steps.push("convex:refresh");
      },
      verifyConvexGeneratedApi: async () => {
        steps.push("convex:verify");
      },
      runGraphifyRebuild: async () => {
        steps.push("graphify:rebuild");
      },
      spawn(command) {
        steps.push(command.join(" "));
        return {
          exited: Promise.resolve(0),
          stderr: new Response("").body,
        };
      },
      logger: {
        log() {},
      },
    });

    expect(steps).toEqual([
      "harness:generate",
      `git add -- ${TRACKED_GENERATED_HARNESS_DOCS.join(" ")}`,
      "convex:changed?",
      "convex:refresh",
      "convex:verify",
      `git add -- ${TRACKED_CONVEX_GENERATED_ARTIFACTS.join(" ")}`,
      "graphify:rebuild",
      `git add -- ${TRACKED_GRAPHIFY_ARTIFACTS.join(" ")}`,
      "git add --update -- .",
    ]);
  });

  it("stages generated artifacts before staging the tracked working tree", async () => {
    const commands: string[][] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {},
      hasConvexSourceChanges: async () => false,
      verifyConvexGeneratedApi: async () => {},
      runGraphifyRebuild: async () => {},
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new Response("").body,
        };
      },
      logger: {
        log() {},
      },
    });

    expect(commands).toEqual([
      ["git", "add", "--", ...TRACKED_GENERATED_HARNESS_DOCS],
      ["git", "add", "--", ...TRACKED_CONVEX_GENERATED_ARTIFACTS],
      ["git", "add", "--", ...TRACKED_GRAPHIFY_ARTIFACTS],
      ["git", "add", "--update", "--", "."],
    ]);
  });

  it("stages tracked source changes after generated artifacts are refreshed", async () => {
    const commands: string[][] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {},
      hasConvexSourceChanges: async () => false,
      verifyConvexGeneratedApi: async () => {},
      runGraphifyRebuild: async () => {},
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new Response("").body,
        };
      },
      logger: {
        log() {},
      },
    });

    expect(commands.at(-1)).toEqual(["git", "add", "--update", "--", "."]);
  });

  it("uses tracked-only staging so untracked local files are left out", async () => {
    const commands: string[][] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {},
      hasConvexSourceChanges: async () => false,
      verifyConvexGeneratedApi: async () => {},
      runGraphifyRebuild: async () => {},
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new Response("").body,
        };
      },
      logger: {
        log() {},
      },
    });

    expect(commands).not.toContainEqual(["git", "add", "--", "."]);
    expect(commands).not.toContainEqual(["git", "add", "-A", "--", "."]);
    expect(commands).toContainEqual(["git", "add", "--update", "--", "."]);
  });

  it("fails clearly when staging repaired harness docs fails", async () => {
    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          return {
            exited: Promise.resolve(1),
            stderr: new Response("git add harness docs failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add harness docs failed");
  });

  it("fails clearly when Convex generated API verification fails", async () => {
    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {
          throw new Error("convex generated api drift");
        },
        runGraphifyRebuild: async () => {},
        spawn() {
          return {
            exited: Promise.resolve(0),
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("convex generated api drift");
  });

  it("fails clearly when Convex generated API refresh fails", async () => {
    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => true,
        refreshConvexGeneratedApi: async () => {
          throw new Error("convex refresh failed");
        },
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          return {
            exited: Promise.resolve(0),
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("convex refresh failed");
  });

  it("refreshes the Convex generated API by default when source changed", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      const commands: Array<{
        command: string[];
        cwd: string;
        stdout: string;
        env?: Record<string, string>;
      }> = [];

      await runPreCommitGeneratedArtifacts(repoDir, {
        runHarnessGenerate: async () => {},
        runGraphifyRebuild: async () => {},
        spawn(command, options) {
          commands.push({
            command,
            cwd: options.cwd,
            stdout: options.stdout,
            env: options.env,
          });

          if (command[0] === "git" && command[1] === "status") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response(
                " M packages/athena-webapp/convex/catalog/items.ts\n"
              ).body,
              stderr: new Response("").body,
            };
          }

          if (command.at(-1) === "-v") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response("v24.14.0\n").body,
              stderr: new Response("").body,
            };
          }

          return {
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      });

      expect(commands).toContainEqual({
        command: ["git", "status", "--porcelain", "--", "packages/athena-webapp/convex"],
        cwd: repoDir,
        stdout: "pipe",
        env: undefined,
      });
      expect(
        commands.some(
          (entry) =>
            entry.command.join(" ") === "bunx convex dev --once" &&
            entry.cwd === path.join(repoDir, "packages", "athena-webapp") &&
            entry.stdout === "inherit"
        )
      ).toBe(true);
    });
  });

  it("prefers a supported Node runtime for Convex generated API refresh", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      const supportedNode = "/opt/homebrew/opt/node@24/bin/node";
      const commands: Array<{ command: string[]; env?: Record<string, string> }> = [];

      await runPreCommitGeneratedArtifacts(repoDir, {
        runHarnessGenerate: async () => {},
        runGraphifyRebuild: async () => {},
        spawn(command, options) {
          commands.push({ command, env: options.env });

          if (command[0] === "git" && command[1] === "status") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response(
                " M packages/athena-webapp/convex/catalog/items.ts\n"
              ).body,
              stderr: new Response("").body,
            };
          }

          if (command[0] === supportedNode && command[1] === "-v") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response("v24.14.0\n").body,
              stderr: new Response("").body,
            };
          }

          if (command.at(-1) === "-v") {
            return {
              exited: Promise.resolve(1),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          }

          return {
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      });

      expect(commands).toContainEqual({
        command: [supportedNode, "-v"],
        env: undefined,
      });
      expect(
        commands.find(
          (entry) => entry.command.join(" ") === "bunx convex dev --once"
        )?.env?.PATH.startsWith(path.dirname(supportedNode))
      ).toBe(true);
    });
  });

  it("classifies a persistent deployment-host DNS failure with recovery guidance", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          resolveHostname: async () => {
            throw Object.assign(new Error("query timed out"), { code: "EAI_AGAIN" });
          },
          retryDelay: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response(
                  " M packages/athena-webapp/convex/catalog/items.ts\n"
                ).body,
                stderr: new Response("").body,
              };
            }
            if (command.at(-1) === "-v") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("v24.14.0\n").body,
                stderr: new Response("").body,
              };
            }
            if (command.join(" ") === "bunx convex dev --once") {
              return {
                exited: Promise.resolve(1),
                stdout: new Response("").body,
                stderr: new Response("TypeError: fetch failed").body,
              };
            }
            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: { log() {} },
        })
      ).rejects.toThrow(
        /DNS resolution failed for jovial-wildebeest-179\.convex\.cloud[\s\S]+EAI_AGAIN[\s\S]+does not change system DNS/
      );
    });
  });

  it("bounds a hanging system-resolver lookup", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          resolveHostname: async () => new Promise(() => {}),
          resolverTimeoutMs: 1,
          retryDelay: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response(
                  " M packages/athena-webapp/convex/catalog/items.ts\n"
                ).body,
                stderr: new Response("").body,
              };
            }
            if (command.at(-1) === "-v") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("v24.14.0\n").body,
                stderr: new Response("").body,
              };
            }
            if (command.join(" ") === "bunx convex dev --once") {
              return {
                exited: Promise.resolve(1),
                stdout: new Response("").body,
                stderr: new Response("TypeError: fetch failed").body,
              };
            }
            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: { log() {} },
        })
      ).rejects.toThrow(/DNS resolution failed[\s\S]+ETIMEDOUT/);
    });
  });

  it("terminates a hanging Convex attempt before diagnosing DNS", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      let convexAttempts = 0;
      let killedAttempts = 0;
      let resolveHungAttempt: ((exitCode: number) => void) | undefined;

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          convexAttemptTimeoutMs: 1,
          convexTerminationGraceMs: 1,
          resolveHostname: async () => {
            throw Object.assign(new Error("temporary resolver failure"), {
              code: "EAI_AGAIN",
            });
          },
          retryDelay: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response(
                  " M packages/athena-webapp/convex/catalog/items.ts\n"
                ).body,
                stderr: new Response("").body,
              };
            }
            if (command.at(-1) === "-v") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("v24.14.0\n").body,
                stderr: new Response("").body,
              };
            }
            if (command.join(" ") === "bunx convex dev --once") {
              convexAttempts += 1;
              return {
                exited:
                  convexAttempts === 1
                    ? new Promise<number>((resolve) => {
                        resolveHungAttempt = resolve;
                      })
                    : Promise.resolve(1),
                kill() {
                  killedAttempts += 1;
                  resolveHungAttempt?.(143);
                },
                stderr: new Response("TypeError: fetch failed").body,
              };
            }
            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: { log() {} },
        })
      ).rejects.toThrow(/DNS resolution failed/);

      expect(convexAttempts).toBe(2);
      expect(killedAttempts).toBe(1);
    });
  });

  it("does not retry when a timed-out Convex process cannot be terminated", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      let convexAttempts = 0;
      let killSignals: string[] = [];

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          convexAttemptTimeoutMs: 1,
          convexTerminationGraceMs: 1,
          resolveHostname: async () => {
            throw new Error("must not diagnose while the child is alive");
          },
          retryDelay: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response(
                  " M packages/athena-webapp/convex/catalog/items.ts\n"
                ).body,
                stderr: new Response("").body,
              };
            }
            if (command.at(-1) === "-v") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("v24.14.0\n").body,
                stderr: new Response("").body,
              };
            }
            if (command.join(" ") === "bunx convex dev --once") {
              convexAttempts += 1;
              return {
                exited: new Promise<number>(() => {}),
                kill(signal) {
                  killSignals.push(signal ?? "");
                },
                stderr: new Response("").body,
              };
            }
            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: { log() {} },
        })
      ).rejects.toThrow(/did not exit after SIGTERM and SIGKILL/);

      expect(convexAttempts).toBe(1);
      expect(killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    });
  });

  it("keeps a Convex attempt timeout distinct when DNS resolves", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      let convexAttempts = 0;
      let resolveHungAttempt: ((exitCode: number) => void) | undefined;

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          convexAttemptTimeoutMs: 1,
          convexTerminationGraceMs: 1,
          resolveHostname: async () => [{ address: "203.0.113.1" }],
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response(
                  " M packages/athena-webapp/convex/catalog/items.ts\n"
                ).body,
                stderr: new Response("").body,
              };
            }
            if (command.at(-1) === "-v") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("v24.14.0\n").body,
                stderr: new Response("").body,
              };
            }
            if (command.join(" ") === "bunx convex dev --once") {
              convexAttempts += 1;
              return {
                exited: new Promise<number>((resolve) => {
                  resolveHungAttempt = resolve;
                }),
                kill() {
                  resolveHungAttempt?.(143);
                },
                stderr: new Response("").body,
              };
            }
            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: { log() {} },
        })
      ).rejects.toThrow(/timed out[\s\S]+DNS[\s\S]+resolved successfully/);

      expect(convexAttempts).toBe(1);
    });
  });

  it("retries once after a confirmed temporary DNS failure", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      let convexAttempts = 0;

      await runPreCommitGeneratedArtifacts(repoDir, {
        runHarnessGenerate: async () => {},
        runGraphifyRebuild: async () => {},
        resolveHostname: async () => {
          throw Object.assign(new Error("temporary resolver failure"), {
            code: "EAI_AGAIN",
          });
        },
        retryDelay: async () => {},
        spawn(command) {
          if (command[0] === "git" && command[1] === "status") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response(
                " M packages/athena-webapp/convex/catalog/items.ts\n"
              ).body,
              stderr: new Response("").body,
            };
          }
          if (command.at(-1) === "-v") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response("v24.14.0\n").body,
              stderr: new Response("").body,
            };
          }
          if (command.join(" ") === "bunx convex dev --once") {
            convexAttempts += 1;
            return {
              exited: Promise.resolve(convexAttempts === 1 ? 1 : 0),
              stdout: new Response("").body,
              stderr: new Response(
                convexAttempts === 1 ? "TypeError: fetch failed" : ""
              ).body,
            };
          }
          return {
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
          };
        },
        logger: { log() {} },
      });

      expect(convexAttempts).toBe(2);
    });
  });

  it.each([
    "Error: Not authorized: invalid deployment credentials",
    "Error: TypeScript source failed to compile",
  ])("preserves non-DNS Convex failures: %s", async (stderr) => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      let resolverCalls = 0;

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          resolveHostname: async () => {
            resolverCalls += 1;
          },
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response(
                  " M packages/athena-webapp/convex/catalog/items.ts\n"
                ).body,
                stderr: new Response("").body,
              };
            }
            if (command.at(-1) === "-v") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("v24.14.0\n").body,
                stderr: new Response("").body,
              };
            }
            if (command.join(" ") === "bunx convex dev --once") {
              return {
                exited: Promise.resolve(1),
                stdout: new Response("").body,
                stderr: new Response(stderr).body,
              };
            }
            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: { log() {} },
        })
      ).rejects.toThrow(stderr);

      expect(resolverCalls).toBe(0);
    });
  });

  it.each([
    "Error: Not authorized: invalid deployment credentials",
    "Error: TypeScript source failed to compile",
  ])("preserves a non-DNS Convex failure after the DNS retry: %s", async (stderr) => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      let convexAttempts = 0;

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          resolveHostname: async () => {
            throw Object.assign(new Error("temporary resolver failure"), {
              code: "EAI_AGAIN",
            });
          },
          retryDelay: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response(
                  " M packages/athena-webapp/convex/catalog/items.ts\n"
                ).body,
                stderr: new Response("").body,
              };
            }
            if (command.at(-1) === "-v") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("v24.14.0\n").body,
                stderr: new Response("").body,
              };
            }
            if (command.join(" ") === "bunx convex dev --once") {
              convexAttempts += 1;
              return {
                exited: Promise.resolve(1),
                stdout: new Response("").body,
                stderr: new Response(
                  convexAttempts === 1 ? "TypeError: fetch failed" : stderr
                ).body,
              };
            }
            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: { log() {} },
        })
      ).rejects.toThrow(stderr);

      expect(convexAttempts).toBe(2);
    });
  });

  it("does not refresh the Convex generated API for generated-only drift", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      const commands: string[] = [];

      await runPreCommitGeneratedArtifacts(repoDir, {
        runHarnessGenerate: async () => {},
        runGraphifyRebuild: async () => {},
        spawn(command, options) {
          commands.push(command.join(" "));

          if (command[0] === "git" && command[1] === "status") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response(
                " M packages/athena-webapp/convex/_generated/api.d.ts\n"
              ).body,
              stderr: new Response("").body,
            };
          }

          return {
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      });

      expect(commands).not.toContain("bunx convex dev --once");
    });
  });

  it("fails when default Convex generated API verification misses a source module", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir, "");

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("").body,
                stderr: new Response("").body,
              };
            }

            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: {
            log() {},
          },
        })
      ).rejects.toThrow(/catalog\/items[\s\S]+bunx convex dev --once/);
    });
  });

  it("fails clearly when default Convex source inspection fails", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(1),
                stdout: new Response("").body,
                stderr: new Response("status failed").body,
              };
            }

            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: {
            log() {},
          },
        })
      ).rejects.toThrow("status failed");
    });
  });

  it("fails clearly when staging repaired Convex generated API fails", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCount += 1;
          if (spawnCount === 1) {
            return {
              exited: Promise.resolve(0),
              stderr: new Response("").body,
            };
          }
          return {
            exited: Promise.resolve(1),
            stderr: new Response("git add convex failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add convex failed");
  });

  it("fails clearly when staging repaired graphify artifacts fails", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCount += 1;
          if (spawnCount < 3) {
            return {
              exited: Promise.resolve(0),
              stderr: new Response("").body,
            };
          }
          return {
            exited: Promise.resolve(1),
            stderr: new Response("git add failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add failed");
  });

  it("fails clearly when staging tracked working-tree changes fails", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCount += 1;
          if (spawnCount < 4) {
            return {
              exited: Promise.resolve(0),
              stderr: new Response("").body,
            };
          }
          return {
            exited: Promise.resolve(1),
            stderr: new Response("git add --update failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add --update failed");
  });

  it("includes the tracked working-tree staging command when git fails without stderr", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCount += 1;
          if (spawnCount < 4) {
            return {
              exited: Promise.resolve(0),
              stderr: new Response("").body,
            };
          }
          return {
            exited: Promise.resolve(1),
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow(
      "Failed to stage tracked working-tree changes (exit 1): git add --update -- ."
    );
  });

  it("keeps the tracked Convex generated API list aligned with repo outputs", () => {
    expect(TRACKED_CONVEX_GENERATED_ARTIFACTS).toEqual([
      path.join("packages", "athena-webapp", "convex", "_generated", "api.d.ts"),
      path.join("packages", "athena-webapp", "convex", "_generated", "api.js"),
      path.join("packages", "athena-webapp", "convex", "_generated", "dataModel.d.ts"),
      path.join("packages", "athena-webapp", "convex", "_generated", "server.d.ts"),
      path.join("packages", "athena-webapp", "convex", "_generated", "server.js"),
    ]);
  });

  it("keeps the tracked graphify artifact list aligned with repo outputs", () => {
    expect(TRACKED_GRAPHIFY_ARTIFACTS).toEqual([
      ...GRAPHIFY_WIKI_ARTIFACTS,
      path.join("graphify-out", "GRAPH_REPORT.md"),
      path.join("graphify-out", "graph.json"),
    ]);
  });
});
