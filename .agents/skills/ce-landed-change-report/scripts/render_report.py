#!/usr/bin/env python3
"""Render a contract-v2 landed-change report from a JSON payload.

Usage: python3 render_report.py input.json docs/reports/<report>.html

The output is a semantic content document with no styling and no scripts —
the Athena webapp renders it as a themed page and hydrates the quiz. The
contract is defined in ../references/report-html-contract.md and enforced by
`bun run reports:presentation:check`.
"""

from __future__ import annotations

import html
import json
import sys

REQUIRED_SECTION_KEYS = (
    "summary",
    "problem",
    "mental-model",
    "before-after",
    "changes",
    "validation",
    "guidance",
)


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def paragraphs(body) -> str:
    if body is None:
        return ""
    if isinstance(body, str):
        body = [body]
    return "\n".join(f"      <p>{esc(item)}</p>" for item in body)


def bullets(items) -> str:
    if not items:
        return ""
    rows = "\n".join(f"        <li>{esc(item)}</li>" for item in items)
    return f"      <ul>\n{rows}\n      </ul>"


def code_block(code) -> str:
    if not code:
        return ""
    return f"      <pre><code>{esc(code)}</code></pre>"


def render_section(section: dict) -> str:
    key = section["key"]
    title = section["title"]
    parts = [p for p in (
        paragraphs(section.get("body")),
        bullets(section.get("bullets")),
        code_block(section.get("code")),
    ) if p]
    body = "\n".join(parts)
    return (
        f'  <section data-report-section="{esc(key)}">\n'
        f"    <h2>{esc(title)}</h2>\n"
        f"{body}\n"
        f"  </section>"
    )


def render_key_files(key_files: list) -> str:
    rows = "\n".join(
        "        <tr>"
        f"<td><code>{esc(entry['path'])}</code></td>"
        f"<td>{esc(entry['purpose'])}</td>"
        "</tr>"
        for entry in key_files
    )
    return (
        '  <section data-report-section="key-files">\n'
        "    <h2>Key files</h2>\n"
        "    <table>\n"
        "      <thead><tr><th>File</th><th>Why it matters</th></tr></thead>\n"
        f"      <tbody>\n{rows}\n      </tbody>\n"
        "    </table>\n"
        "  </section>"
    )


def render_quiz(quiz: dict) -> str:
    threshold = int(quiz["passThreshold"])
    questions = quiz["questions"]
    if len(questions) < 5:
        raise SystemExit("Quiz must have at least 5 questions.")
    if not 1 <= threshold <= len(questions):
        raise SystemExit("Quiz passThreshold must be between 1 and the question count.")

    items = []
    for question in questions:
        answer_index = int(question["answer"])
        options = []
        for index, option in enumerate(question["options"]):
            correct = " data-quiz-correct" if index == answer_index else ""
            options.append(f"          <li{correct}>{esc(option)}</li>")
        items.append(
            "      <li data-quiz-question>\n"
            f"        <p data-quiz-prompt>{esc(question['question'])}</p>\n"
            "        <ol data-quiz-options>\n"
            + "\n".join(options)
            + "\n        </ol>\n"
            f"        <p data-quiz-explanation>{esc(question['explanation'])}</p>\n"
            "      </li>"
        )
    return (
        f'  <section data-report-section="quiz" data-quiz-pass-threshold="{threshold}">\n'
        "    <h2>Comprehension quiz</h2>\n"
        f"    <p>Pass required: {threshold} of {len(questions)}.</p>\n"
        "    <ol data-quiz>\n"
        + "\n".join(items)
        + "\n    </ol>\n  </section>"
    )


def render_subagents(subagents: list) -> str:
    rows = "\n".join(
        f"      <dt>{esc(entry['role'])}</dt><dd>{esc(entry['summary'])}</dd>"
        for entry in subagents
    )
    return (
        '  <section data-report-section="subagent-evidence">\n'
        "    <h2>Subagent evidence</h2>\n"
        f"    <dl>\n{rows}\n    </dl>\n"
        "  </section>"
    )


def root_attributes(payload: dict) -> str:
    attrs = ['data-athena-landed-change-report="v2"']
    fingerprint = payload.get("deliverableDiffFingerprint") or payload.get("diffFingerprint")
    if fingerprint:
        attrs.append(f'data-athena-report-diff-fingerprint="{esc(fingerprint)}"')
    if payload.get("reportBase"):
        attrs.append(f'data-athena-report-base="{esc(payload["reportBase"])}"')
    if payload.get("reportHead"):
        attrs.append(f'data-athena-report-head="{esc(payload["reportHead"])}"')
    return " ".join(attrs)


def render(payload: dict) -> str:
    provided_keys = {section["key"] for section in payload.get("sections", [])}
    missing = [key for key in REQUIRED_SECTION_KEYS if key not in provided_keys]
    if missing:
        raise SystemExit(
            f"Payload sections are missing required keys: {', '.join(missing)}."
        )
    if "keyFiles" not in payload:
        raise SystemExit("Payload requires keyFiles for the key-files section.")
    if "subagents" not in payload or not payload["subagents"]:
        raise SystemExit(
            "Payload requires subagents (use role SubagentUnavailable if none ran)."
        )

    pills = "\n".join(
        f"      <li>{esc(pill)}</li>" for pill in payload.get("metadata", [])
    )
    if not pills:
        raise SystemExit("Payload requires metadata pills (status, PR, evidence).")

    meta_pairs = payload.get("meta", {})
    meta_html = ""
    if meta_pairs:
        rows = "\n".join(
            f"      <dt>{esc(key)}</dt><dd>{esc(value)}</dd>"
            for key, value in meta_pairs.items()
        )
        meta_html = f"\n    <dl data-report-meta>\n{rows}\n    </dl>"

    subtitle = payload.get("subtitle")
    subtitle_html = f"\n    <p>{esc(subtitle)}</p>" if subtitle else ""

    sections = [render_section(section) for section in payload["sections"]]
    sections.append(render_key_files(payload["keyFiles"]))
    # Contract order: quiz and subagent-evidence close the article.
    sections.append(render_quiz(payload["quiz"]))
    sections.append(render_subagents(payload["subagents"]))

    body = "\n".join(sections)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{esc(payload["title"])}</title>
</head>
<body>
<article {root_attributes(payload)}>
  <header data-report-section="header">
    <h1>{esc(payload["title"])}</h1>{subtitle_html}
    <ul data-report-pills>
{pills}
    </ul>{meta_html}
  </header>
{body}
</article>
</body>
</html>
"""


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: render_report.py input.json output.html")
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    output = render(payload)
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        handle.write(output)
    print(f"Wrote {sys.argv[2]}")


if __name__ == "__main__":
    main()
