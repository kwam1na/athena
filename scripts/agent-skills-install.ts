/** Updates Athena from an artifact through its already installed trusted lifecycle. */
import path from "node:path";

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const child = Bun.spawn(["python3", "-B", path.resolve(".agent-skills/current"), "--root", process.cwd(), "--product", "update", ...argv], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exitCode = await child.exited;
}
