"""Install dependencies only in a fresh native validation workspace."""

import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

LOCK = ".graphify-validation-requirements.lock"
VENV = ".athena-validation-python"


class SetupArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        # argparse's default SystemExit bypasses the shared typed CLI boundary.
        raise ValueError(message)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = SetupArgumentParser(description=__doc__)
    parser.add_argument("profile", choices=("core", "browser"))
    return parser.parse_args(argv)


def validate_root(root: Path) -> None:
    if os.path.lexists(root / "node_modules"):
        raise ValueError("Fresh private workspace required: node_modules already exists")
    if (root / ".graphify_python").is_symlink():
        raise ValueError("Author interpreter links are not private dependency inputs")
    for name in ("package.json", "bun.lockb", LOCK):
        if not (root / name).is_file() or (root / name).is_symlink():
            raise ValueError(f"Missing regular frozen dependency input: {name}")
    if json.loads((root / "package.json").read_text()).get("packageManager") != "bun@1.1.29":
        raise ValueError("Expected packageManager bun@1.1.29")


def environment(root: Path) -> dict[str, str]:
    env = {
        key: value for key, value in os.environ.items()
        if not key.startswith(("PYTHON", "PIP_", "BUN_INSTALL_"))
        and key not in ("VIRTUAL_ENV", "UV_CACHE_DIR", "BUN_TMPDIR")
    }
    private = root / "node_modules"
    env.update({
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "PIP_CONFIG_FILE": os.devnull,
        "BUN_INSTALL_CACHE_DIR": str(private / ".athena-validation-cache"),
        "TMPDIR": str(private / ".athena-validation-tmp"),
        "PLAYWRIGHT_BROWSERS_PATH": "0",
    })
    return env


def commands(root: Path, profile: str, python: str, bun: str) -> list[tuple[str, list[str]]]:
    venv = root / "node_modules" / VENV
    steps = [
        ("bun", [bun, "install", "--frozen-lockfile", "--ignore-scripts"]),
        ("venv", [python, "-I", "-m", "venv", "--copies", str(venv)]),
        ("python", [str(venv / "bin/python3"), "-I", "-B", "-m", "pip", "--isolated",
                    "install", "--require-hashes", "--only-binary=:all:",
                    "--no-cache-dir", "--no-compile", "--disable-pip-version-check",
                    "--index-url", "https://pypi.org/simple", "-r", str(root / LOCK)]),
        ("python-check", [str(venv / "bin/python3"), "-I", "-B", "-m", "pip",
                          "--isolated", "check"]),
    ]
    if profile == "browser":
        steps.append(("browser", [bun, "x", "playwright", "install", "chromium"]))
    return steps


def write_wrapper(root: Path) -> None:
    wrapper = root / "node_modules/.bin/python3"
    if os.path.lexists(wrapper):
        raise ValueError("Refusing to replace an existing python3 dependency executable")
    wrapper.parent.mkdir(exist_ok=True)
    wrapper.write_text('#!/bin/sh\nexec "${0%/*}/../.athena-validation-python/bin/python3" -B "$@"\n')
    wrapper.chmod(0o755)


def main(argv: list[str]) -> None:
    args = parse_args(argv)
    if sys.version_info[:2] not in ((3, 12), (3, 14)):
        raise ValueError("Qualified setup requires Python 3.12 or 3.14")
    if (sys.platform, platform.machine()) not in (("darwin", "arm64"), ("linux", "x86_64")):
        raise ValueError("Qualified setup requires macOS arm64 or Linux x86_64")
    root = Path.cwd()
    validate_root(root)
    bun = shutil.which("bun")
    if not bun or subprocess.check_output([bun, "--version"], text=True).strip() != "1.1.29":
        raise ValueError("Selected Bun executable must be version 1.1.29")
    env = environment(root)
    (root / "node_modules").mkdir()
    Path(env["TMPDIR"]).mkdir()
    timings = {}
    for name, command in commands(root, args.profile, sys.executable, bun):
        if name == "browser":
            # Bun 1.1.29 bunx has no no-install flag. Require the locally locked
            # CLI first so this invocation cannot fall back to fetching a CLI.
            cli = root / "node_modules/.bin/playwright"
            if not cli.is_file() or not cli.resolve().is_relative_to(root / "node_modules"):
                raise ValueError("Private locked Playwright CLI is missing")
        started = time.monotonic()
        subprocess.run(command, cwd=root, env=env, check=True)
        timings[name] = round(time.monotonic() - started, 3)
    write_wrapper(root)
    # Cache/temp material is not a dependency and must not become a reusable
    # input or link to author state. All installed packages remain private.
    shutil.rmtree(env["BUN_INSTALL_CACHE_DIR"], ignore_errors=True)
    shutil.rmtree(env["TMPDIR"], ignore_errors=True)
    print(json.dumps({"profile": args.profile, "seconds": timings}))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({
            "schemaVersion": 1,
            "blockers": [{
                "code": "validation_dependency_setup_failed",
                "source": {"kind": "command", "id": "harness:validation-dependencies"},
                "summary": "Private validation dependencies could not be installed.",
                "details": str(error)[:8000],
                "remediations": [{
                    "id": "repair-private-validation-dependencies", "kind": "code_change",
                    "summary": "Repair the pinned dependency inputs or supported toolchain, then retry in a fresh native workspace.",
                }],
            }],
        }), file=sys.stderr)
        sys.exit(1)
