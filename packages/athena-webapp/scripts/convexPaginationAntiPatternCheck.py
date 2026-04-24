#!/usr/bin/env python3

import argparse
import pathlib
import re
from typing import List, Optional


def strip_code(text: str) -> str:
  stripped = []
  in_line_comment = False
  in_block_comment = False
  in_single_quote = False
  in_double_quote = False
  in_backtick = False
  i = 0
  length = len(text)

  while i < length:
    char = text[i]
    nxt = text[i + 1] if i + 1 < length else ""

    if in_line_comment:
      if char == "\n":
        in_line_comment = False
        stripped.append("\n")
      else:
        stripped.append(" ")
      i += 1
      continue

    if in_block_comment:
      if char == "*" and nxt == "/":
        in_block_comment = False
        stripped.extend([" ", " "])
        i += 2
      else:
        stripped.append("\n" if char == "\n" else " ")
        i += 1
      continue

    if in_single_quote:
      if char == "\\":
        stripped.append(" ")
        if nxt:
          stripped.append(" ")
          i += 2
        else:
          i += 1
        continue
      if char == "'":
        in_single_quote = False
      stripped.append(" ")
      i += 1
      continue

    if in_double_quote:
      if char == "\\":
        stripped.append(" ")
        if nxt:
          stripped.append(" ")
          i += 2
        else:
          i += 1
        continue
      if char == '"':
        in_double_quote = False
      stripped.append(" ")
      i += 1
      continue

    if in_backtick:
      if char == "\\":
        stripped.append(" ")
        if nxt:
          stripped.append(" ")
          i += 2
        else:
          i += 1
        continue
      if char == "`":
        in_backtick = False
      stripped.append(" ")
      i += 1
      continue

    if char == "/" and nxt == "/":
      in_line_comment = True
      stripped.extend([" ", " "])
      i += 2
      continue

    if char == "/" and nxt == "*":
      in_block_comment = True
      stripped.extend([" ", " "])
      i += 2
      continue

    if char == "'":
      in_single_quote = True
      stripped.append(" ")
      i += 1
      continue

    if char == '"':
      in_double_quote = True
      stripped.append(" ")
      i += 1
      continue

    if char == "`":
      in_backtick = True
      stripped.append(" ")
      i += 1
      continue

    stripped.append(char)
    i += 1

  return "".join(stripped)


def find_block_end(text: str, open_brace: int) -> Optional[int]:
  depth = 0
  i = open_brace
  while i < len(text):
    if text[i] == "{":
      depth += 1
    elif text[i] == "}":
      depth -= 1
      if depth == 0:
        return i
    i += 1
  return None


def scan_file(path: pathlib.Path):
  text = path.read_text()
  clean_text = strip_code(text)

  patterns = [
    (
      re.compile(
        r"\basync\s+function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{"
      ),
      "async function",
    ),
    (
      re.compile(
        r"\bhandler\s*:\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{"
      ),
      "handler",
    ),
    (
      re.compile(
        r"\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{"
      ),
      "const handler",
    ),
  ]

  violations = []
  for pattern, pattern_name in patterns:
    for match in pattern.finditer(clean_text):
      open_brace = match.end() - 1
      close_brace = find_block_end(clean_text, open_brace)
      if close_brace is None:
        continue

      function_body = clean_text[open_brace + 1 : close_brace]
      paginate_count = function_body.count(".paginate(")
      if paginate_count <= 1:
        continue

      name = match.group(1) if match.groups() else pattern_name
      start_line = clean_text.count("\n", 0, open_brace) + 1
      violations.append({
        "path": path.as_posix(),
        "name": name,
        "line": start_line,
        "count": paginate_count,
      })

  return violations


def list_convex_files(base_dir: pathlib.Path, files: List[str]):
  if files:
    candidates = []
    for candidate in files:
      candidate_path = candidate
      path = base_dir / candidate_path
      if not path.exists():
        # Files can be absolute from shell scripts, preserve behavior for tooling
        path = pathlib.Path(candidate_path)
      candidates.append(path)
  else:
    candidates = list(base_dir.joinpath("convex").rglob("*.ts"))
    candidates = [
      candidate
      for candidate in candidates
      if "_generated" not in candidate.parts
    ]
  return candidates


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("base_dir")
  parser.add_argument("files", nargs="*")
  args = parser.parse_args()

  base_dir = pathlib.Path(args.base_dir)
  files = list_convex_files(base_dir, args.files)
  files = [
    path
    for path in files
    if path.suffix == ".ts" and "_generated" not in path.parts
  ]

  violations = []
  for file_path in files:
    violations.extend(scan_file(file_path))

  if not violations:
    if args.files:
      print("Convex pagination anti-pattern check passed for changed files")
    else:
      print("Convex pagination anti-pattern check passed")
    return

  print("Convex pagination anti-pattern check failed")
  for violation in violations:
    print(
      f"  {violation['path']}:{violation['line']} "
      f"({violation['name']}) has {violation['count']} paginate calls"
    )
  raise SystemExit(1)


if __name__ == "__main__":
  main()
