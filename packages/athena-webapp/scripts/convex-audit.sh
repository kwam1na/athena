#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONVEX_DIR="$ROOT_DIR/convex"

if command -v rg >/dev/null 2>&1; then
  SEARCH_BACKEND="rg"
elif command -v grep >/dev/null 2>&1; then
  SEARCH_BACKEND="grep"
else
  echo "audit:convex requires either ripgrep (rg) or grep" >&2
  exit 1
fi

search_fixed() {
  local pattern="$1"

  if [ "$SEARCH_BACKEND" = "rg" ]; then
    rg -n -F --glob '!convex/_generated/**' "$pattern" "$CONVEX_DIR"
    return
  fi

  grep -RInF --exclude-dir=_generated -- "$pattern" "$CONVEX_DIR"
}

search_regex() {
  local pattern="$1"

  if [ "$SEARCH_BACKEND" = "rg" ]; then
    rg -n --glob '!convex/_generated/**' "$pattern" "$CONVEX_DIR"
    return
  fi

  grep -RInE --exclude-dir=_generated -- "$pattern" "$CONVEX_DIR"
}

count_fixed_matches() {
  local pattern="$1"
  search_fixed "$pattern" | wc -l | tr -d ' '
}

echo "Convex audit report"
echo "Root: $ROOT_DIR"
echo

echo "Counts"
echo "------"
echo "Public functions missing args: $(python3 - "$CONVEX_DIR" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
pat = re.compile(r'export const .* = (query|mutation|action)\(\{')
args_pat = re.compile(r'args\s*:')
missing = 0
for path in root.rglob('*.ts'):
    if '_generated' in path.parts:
        continue
    text = path.read_text()
    for match in pat.finditer(text):
        handler_idx = text.find('handler', match.start())
        snippet = text[match.start():(handler_idx if handler_idx != -1 else match.start() + 500)]
        if not args_pat.search(snippet):
            missing += 1
print(missing)
PY
)"
implicit_db_calls=$(( \
  $(count_fixed_matches 'ctx.db.get(') + \
  $(count_fixed_matches 'ctx.db.patch(') + \
  $(count_fixed_matches 'ctx.db.replace(') + \
  $(count_fixed_matches 'ctx.db.delete(') \
))

echo "Implicit db table IDs: $implicit_db_calls"
echo "Query .collect() calls: $(count_fixed_matches '.collect(')"
echo "Query builder .filter((q) calls: $(count_fixed_matches '.filter((q)')"
echo "ctx.runQuery calls: $(count_fixed_matches 'ctx.runQuery(')"
echo "ctx.runMutation calls: $(count_fixed_matches 'ctx.runMutation(')"
echo "ctx.runAction calls: $(count_fixed_matches 'ctx.runAction(')"
echo "api.* refs inside Convex: $(count_fixed_matches 'api.')"
echo "Date.now() occurrences: $(count_fixed_matches 'Date.now(')"
echo

echo "Top files by hotspot count"
echo "--------------------------"
python3 - "$CONVEX_DIR" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
patterns = [
    re.compile(r'\.filter\(\(?q'),
    re.compile(r'\.collect\('),
    re.compile(r'ctx\.runQuery\('),
    re.compile(r'ctx\.runMutation\('),
    re.compile(r'ctx\.runAction\('),
    re.compile(r'ctx\.db\.(get|patch|replace|delete)\([^",]'),
    re.compile(r'Date\.now\('),
]
scores = []
for path in root.rglob('*.ts'):
    if '_generated' in path.parts:
        continue
    text = path.read_text()
    score = sum(len(pattern.findall(text)) for pattern in patterns)
    if score:
        scores.append((score, path.relative_to(root.parent).as_posix()))
for score, path in sorted(scores, reverse=True)[:15]:
    print(f'{score:>4}  {path}')
PY
echo

echo "Sample implicit db ID locations"
echo "-------------------------------"
search_regex 'ctx\.db\.(get|patch|replace|delete)\([^\",]' | sed -n '1,20p' || true
echo

echo "Sample public api refs inside Convex"
echo "------------------------------------"
search_regex 'api\.(app|inventory|storeFront)\.' | sed -n '1,20p' || true
