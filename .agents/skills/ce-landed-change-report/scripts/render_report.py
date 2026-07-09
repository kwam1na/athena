#!/usr/bin/env python3
"""Render a standalone landed-change HTML report from a JSON payload."""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path
from typing import Any


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def render_paragraphs(body: Any) -> str:
    if body is None:
        return ""
    paragraphs = body if isinstance(body, list) else [body]
    return "\n".join(f"<p>{esc(paragraph)}</p>" for paragraph in paragraphs)


def render_section(section: dict[str, Any]) -> str:
    parts = [f"<section class=\"panel\"><h2>{esc(section.get('title', 'Section'))}</h2>"]
    parts.append(render_paragraphs(section.get("body")))
    bullets = section.get("bullets") or []
    if bullets:
        parts.append("<ul>")
        parts.extend(f"<li>{esc(item)}</li>" for item in bullets)
        parts.append("</ul>")
    if section.get("code"):
        parts.append(f"<pre><code>{esc(section['code'])}</code></pre>")
    parts.append("</section>")
    return "\n".join(parts)


def render_metadata(metadata: list[Any]) -> str:
    return "".join(f"<span class=\"pill\">{esc(item)}</span>" for item in metadata)


def render_root_attributes(payload: dict[str, Any]) -> str:
    attrs = ['lang="en"', 'data-athena-landed-change-report="v1"']
    fingerprint = payload.get("deliverableDiffFingerprint") or payload.get("diffFingerprint")
    if fingerprint:
        attrs.append(f'data-athena-report-diff-fingerprint="{esc(fingerprint)}"')
    if payload.get("reportBase"):
        attrs.append(f'data-athena-report-base="{esc(payload["reportBase"])}"')
    if payload.get("reportHead"):
        attrs.append(f'data-athena-report-head="{esc(payload["reportHead"])}"')
    return " ".join(attrs)


def render_key_files(files: list[dict[str, Any]]) -> str:
    if not files:
        return ""
    rows = "\n".join(
        "<tr>"
        f"<td><code>{esc(item.get('path', ''))}</code></td>"
        f"<td>{esc(item.get('purpose', ''))}</td>"
        "</tr>"
        for item in files
    )
    return f"""
<section class="panel">
  <h2>Key Files</h2>
  <table>
    <thead><tr><th>File</th><th>Why It Matters</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</section>
"""


def render_subagents(subagents: list[dict[str, Any]]) -> str:
    if not subagents:
        subagents = [
            {
                "role": "SubagentUnavailable",
                "summary": "No subagent evidence was recorded.",
            }
        ]
    items = "\n".join(
        f"<li><strong>{esc(item.get('role', 'subagent'))}:</strong> {esc(item.get('summary', ''))}</li>"
        for item in subagents
    )
    return f"""
<section class="panel">
  <h2>Subagent Evidence</h2>
  <ul>{items}</ul>
</section>
"""


def render_quiz(quiz: dict[str, Any]) -> str:
    questions = quiz.get("questions") or []
    threshold = int(quiz.get("passThreshold") or max(1, round(len(questions) * 0.8)))
    rendered_questions: list[str] = []
    for index, question in enumerate(questions, start=1):
        answer = int(question.get("answer", 0))
        options = question.get("options") or []
        rendered_options = "\n".join(
            f"<label><input type=\"radio\" name=\"q{index}\" value=\"{option_index}\" /> {esc(option)}</label>"
            for option_index, option in enumerate(options)
        )
        rendered_questions.append(
            f"""
<div class="quiz-question" data-answer="{answer}">
  <fieldset>
    <legend>{index}. {esc(question.get('question', 'Question'))}</legend>
    {rendered_options}
  </fieldset>
  <div class="answer-detail">{esc(question.get('explanation', ''))}</div>
</div>
"""
        )
    return f"""
<section id="quiz" class="panel">
  <h2>Quiz: Pass Required</h2>
  <p>You must score at least {threshold} out of {len(questions)} to pass.</p>
  <form id="changeQuiz" data-threshold="{threshold}">
    {''.join(rendered_questions)}
    <div class="quiz-actions">
      <button type="button" id="gradeQuiz">Grade quiz</button>
      <button type="button" class="secondary" id="resetQuiz">Reset</button>
      <span id="quizResult" aria-live="polite"></span>
    </div>
  </form>
</section>
"""


def render_html(payload: dict[str, Any]) -> str:
    title = payload.get("title", "Landed Change Report")
    subtitle = payload.get("subtitle", "A digestible explanation of the landed work.")
    sections = "\n".join(render_section(section) for section in payload.get("sections", []))
    metadata = render_metadata(payload.get("metadata", []))
    key_files = render_key_files(payload.get("keyFiles", []))
    subagents = render_subagents(payload.get("subagents", []))
    quiz = render_quiz(payload.get("quiz", {"questions": []}))
    root_attributes = render_root_attributes(payload)
    return f"""<!doctype html>
<html {root_attributes}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{esc(title)}</title>
    <style>
      :root {{
        --ink: #1f2933;
        --muted: #596674;
        --line: #d9e2ec;
        --paper: #ffffff;
        --soft: #f6f8fb;
        --accent: #1d4ed8;
        --accent-soft: #dbeafe;
        --good: #166534;
        --bad: #b91c1c;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        background: var(--soft);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.55;
      }}
      main {{ max-width: 1120px; margin: 0 auto; padding: 48px 24px 72px; }}
      header {{ border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 28px; }}
      h1, h2, h3 {{ line-height: 1.18; letter-spacing: 0; }}
      h1 {{ font-size: 42px; max-width: 880px; margin: 0 0 16px; }}
      h2 {{ font-size: 28px; margin: 0 0 16px; }}
      p {{ margin: 0 0 14px; }}
      .lede {{ color: var(--muted); font-size: 18px; max-width: 880px; }}
      .meta {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }}
      .pill {{ border: 1px solid var(--line); border-radius: 999px; background: var(--paper); color: var(--muted); font-size: 13px; padding: 6px 10px; }}
      .panel {{ background: var(--paper); border: 1px solid var(--line); border-radius: 8px; margin: 18px 0; padding: 22px; }}
      code {{ background: #eef2f7; border: 1px solid #d8dee8; border-radius: 5px; padding: 1px 5px; }}
      pre {{ overflow: auto; background: #111827; color: #e5e7eb; border-radius: 8px; padding: 16px; }}
      pre code {{ background: transparent; border: 0; color: inherit; padding: 0; }}
      table {{ width: 100%; border-collapse: collapse; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }}
      th, td {{ border-bottom: 1px solid var(--line); padding: 11px 12px; text-align: left; vertical-align: top; }}
      th {{ background: #eef2f7; color: var(--muted); font-size: 13px; text-transform: uppercase; }}
      tr:last-child td {{ border-bottom: 0; }}
      .quiz-question {{ border-top: 1px solid var(--line); padding: 18px 0; }}
      .quiz-question:first-child {{ border-top: 0; }}
      fieldset {{ border: 0; margin: 0; padding: 0; }}
      legend {{ font-weight: 700; margin-bottom: 10px; }}
      label {{ display: block; border: 1px solid var(--line); border-radius: 8px; background: #fbfdff; margin: 8px 0; padding: 10px 12px; cursor: pointer; }}
      @media (hover: hover) and (pointer: fine) {{
        label:hover {{ border-color: #b6c5d8; }}
      }}
      button {{
        appearance: none;
        border: 0;
        border-radius: 8px;
        background: var(--accent);
        color: #ffffff;
        cursor: pointer;
        font-weight: 700;
        padding: 11px 16px;
        transition: transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
      }}
      button:active {{ transform: scale(0.97); }}
      button.secondary {{ background: #475569; }}
      .quiz-actions {{ display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 20px; }}
      #quizResult {{ font-weight: 700; }}
      .answer-detail {{ display: none; border-top: 1px dashed var(--line); color: var(--muted); margin-top: 10px; padding-top: 10px; }}
      .answer-detail.visible {{ display: block; }}
      .correct {{ border-color: #86efac !important; background: #f0fdf4 !important; }}
      .incorrect {{ border-color: #fecaca !important; background: #fef2f2 !important; }}
      @media (prefers-reduced-motion: reduce) {{ button {{ transition-duration: 0ms; }} }}
      @media (max-width: 820px) {{ h1 {{ font-size: 32px; }} main {{ padding: 32px 16px 56px; }} }}
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>{esc(title)}</h1>
        <p class="lede">{esc(subtitle)}</p>
        <div class="meta">{metadata}</div>
      </header>
      {sections}
      {key_files}
      {subagents}
      {quiz}
    </main>
    <script>
      const questions = Array.from(document.querySelectorAll(".quiz-question"));
      const result = document.getElementById("quizResult");
      const form = document.getElementById("changeQuiz");
      const threshold = Number(form.dataset.threshold || 0);
      function clearGrades() {{
        questions.forEach((question) => {{
          question.classList.remove("correct", "incorrect");
          question.querySelector(".answer-detail").classList.remove("visible");
        }});
        result.textContent = "";
        result.style.color = "";
      }}
      document.getElementById("gradeQuiz").addEventListener("click", () => {{
        clearGrades();
        let score = 0;
        questions.forEach((question, index) => {{
          const selected = document.querySelector(`input[name="q${{index + 1}}"]:checked`);
          const isCorrect = selected && Number(selected.value) === Number(question.dataset.answer);
          if (isCorrect) score += 1;
          question.classList.add(isCorrect ? "correct" : "incorrect");
          question.querySelector(".answer-detail").classList.add("visible");
        }});
        const passed = score >= threshold;
        result.textContent = passed
          ? `Passed: ${{score}}/${{questions.length}}.`
          : `Not passed: ${{score}}/${{questions.length}}. Review the report and try again.`;
        result.style.color = passed ? "var(--good)" : "var(--bad)";
      }});
      document.getElementById("resetQuiz").addEventListener("click", () => {{
        form.reset();
        clearGrades();
      }});
    </script>
  </body>
</html>
"""


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: render_report.py input.json output.html", file=sys.stderr)
        return 2
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_html(payload), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
