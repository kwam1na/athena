import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const helper = resolve(
  import.meta.dirname,
  "harness-validation-dependencies.py",
);
function python(body: string) {
  return spawnSync(
    "python3",
    [
      "-B",
      "-c",
      `
import importlib.util, pathlib, tempfile, json, os
spec = importlib.util.spec_from_file_location("dependencies", ${JSON.stringify(helper)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
${body}
`,
    ],
    { encoding: "utf8" },
  );
}
function passes(body: string) {
  const result = python(body);
  expect({ status: result.status, stderr: result.stderr }).toEqual({
    status: 0,
    stderr: "",
  });
}

describe("private validation dependencies", () => {
  it("accepts only the two native setup profiles", () => {
    passes(`
assert m.parse_args(["core"]).profile == "core"
assert m.parse_args(["browser"]).profile == "browser"
`);
    for (const args of [["unexpected"], ["core", "--unknown"]]) {
      const result = spawnSync("python3", ["-B", helper, ...args], {
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr).blockers[0]).toMatchObject({
        code: "validation_dependency_setup_failed",
        source: { kind: "command", id: "harness:validation-dependencies" },
      });
    }
  });
  it("binds frozen script-free Bun and hash-checked copied Python setup", () => {
    passes(`
steps = m.commands(pathlib.Path("/private checkout"), "core", "/host/python3", "/host/bun")
assert steps[0][1] == ["/host/bun", "install", "--frozen-lockfile", "--ignore-scripts"]
assert steps[1][1] == ["/host/python3", "-I", "-m", "venv", "--copies", "/private checkout/node_modules/.athena-validation-python"]
install = steps[2][1]
assert "--require-hashes" in install and "--only-binary=:all:" in install
assert "--no-cache-dir" in install and "--no-compile" in install
assert "--no-deps" not in install
assert not any("playwright" in arg for _, argv in steps for arg in argv)
`);
  });
  it("adds only private Chromium installation for the browser profile", () => {
    passes(`
steps = m.commands(pathlib.Path("/private"), "browser", "/python3", "/bun")
assert steps[-1] == ("browser", ["/bun", "x", "playwright", "install", "chromium"])
assert steps[:-1] == m.commands(pathlib.Path("/private"), "core", "/python3", "/bun")
`);
  });
  it("refuses author dependency or interpreter paths before setup", () => {
    passes(`
for entry, message in (("node_modules", "Fresh private workspace required"), (".graphify_python", "Author interpreter links")):
 with tempfile.TemporaryDirectory() as tmp:
  root=pathlib.Path(tmp)
  (root/"package.json").write_text('{"packageManager":"bun@1.1.29"}')
  (root/"bun.lockb").write_bytes(b"lock")
  (root/m.LOCK).write_text("locked")
  m.validate_root(root)
  (root/entry).symlink_to("/missing-author-state")
  try: m.validate_root(root)
  except ValueError as error: assert message in str(error), str(error)
  else: raise AssertionError(entry)
`);
  });
  it("rejects wrong package manager and missing frozen lockfile", () => {
    passes(`
for version, has_lock in (("9", True), ("1.1.29", False)):
 with tempfile.TemporaryDirectory() as tmp:
  root=pathlib.Path(tmp); (root/"package.json").write_text(json.dumps({"packageManager":"bun@"+version}))
  (root/m.LOCK).write_text("locked")
  if has_lock: (root/"bun.lockb").write_bytes(b"lock")
  try: m.validate_root(root)
  except ValueError: pass
  else: raise AssertionError("unsafe root accepted")
`);
  });
  it("removes inherited Python and pip overrides and uses private cache paths", () => {
    passes(`
os.environ.update(PYTHONPATH="/author", PYTHONHOME="/author", VIRTUAL_ENV="/author", PIP_TARGET="/author", BUN_INSTALL_CACHE_DIR="/author")
e = m.environment(pathlib.Path("/private"))
assert all(k not in e for k in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "PIP_TARGET"))
assert e["BUN_INSTALL_CACHE_DIR"].startswith("/private/node_modules/")
assert e["PLAYWRIGHT_BROWSERS_PATH"] == "0"
assert e["PIP_CONFIG_FILE"] == os.devnull
assert e["PYTHONDONTWRITEBYTECODE"] == "1"
`);
  });
  it("creates a relocatable wrapper using only the private venv", () => {
    passes(`
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp); (root/"node_modules/.bin").mkdir(parents=True)
 m.write_wrapper(root)
 wrapper=root/"node_modules/.bin/python3"
 assert not wrapper.is_symlink()
 text=wrapper.read_text()
 assert ".athena-validation-python/bin/python3" in text
 assert "/author" not in text and tmp not in text
 assert wrapper.stat().st_mode & 0o111
`);
  });
});

it("refuses a wrong Bun before creating private dependency state", () => {
  passes(`
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp)
 (root/"package.json").write_text('{"packageManager":"bun@1.1.29"}')
 (root/"bun.lockb").write_bytes(b"lock")
 (root/m.LOCK).write_text("locked")
 m.shutil.which=lambda name: "/wrong/bun"
 m.subprocess.check_output=lambda *a, **kw: "1.2.0"
 previous=os.getcwd(); os.chdir(root)
 try:
  try: m.main(["core"])
  except ValueError as error: assert "1.1.29" in str(error)
  else: raise AssertionError("wrong Bun accepted")
  assert not (root/"node_modules").exists()
 finally: os.chdir(previous)
`);
});

it("propagates install failure without exposing a successful wrapper", () => {
  passes(`
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp)
 (root/"package.json").write_text('{"packageManager":"bun@1.1.29"}')
 (root/"bun.lockb").write_bytes(b"lock")
 (root/m.LOCK).write_text("locked")
 m.shutil.which=lambda name: "/bun"
 m.subprocess.check_output=lambda *a, **kw: "1.1.29"
 def fail(command, **kwargs): raise m.subprocess.CalledProcessError(42,command)
 m.subprocess.run=fail
 previous=os.getcwd(); os.chdir(root)
 try:
  try: m.main(["core"])
  except m.subprocess.CalledProcessError as error: assert error.returncode == 42
  else: raise AssertionError("failed install accepted")
  assert not (root/"node_modules/.bin/python3").exists()
 finally: os.chdir(previous)
`);
});

it("refuses an unqualified Python or platform before filesystem setup", () => {
  passes(`
original=m.sys.version_info
m.sys.version_info=(3, 13)
try: m.main(["core"])
except ValueError as error: assert "3.12 or 3.14" in str(error)
else: raise AssertionError("unqualified Python accepted")
m.sys.version_info=original
m.platform.machine=lambda: "unknown-machine"
try: m.main(["core"])
except ValueError as error: assert "macOS arm64 or Linux x86_64" in str(error)
else: raise AssertionError("unqualified machine accepted")
`);
});
