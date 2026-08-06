# Landed-Change Report HTML Contract (v2)

Delivery reports are **semantic content documents**. They carry no styling and
no scripts of their own: the Athena webapp renders them as themed pages at
`/docs/reports/$slug`, owns all presentation, and hydrates the quiz. The raw
file stays readable when opened directly, just unstyled.

Enforcement is split in two, on purpose:

- **`bun run reports:presentation:check`** runs over every file in
  `docs/reports/*.html`, always. It enforces the *presentational* rules: the
  v2 root marker, no styling or scripting, the header and pills, one `<h2>`
  opening each section, kebab-case keys, a well-formed quiz, and quiz/evidence
  ordering.
- **`bun run landed-report:check`** additionally requires the full narrative
  vocabulary, the key-files table, subagent evidence, and a five-question quiz
  — but only of reports authored or changed on the current branch.

The split exists because historical reports predate parts of this contract.
Retro-fitting them would mean inventing sections and answer keys they never
had, which is worse than not having them. New reports owe the whole thing.

## File shell

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Report title</title>
  </head>
  <body>
    <article
      data-athena-landed-change-report="v2"
      data-athena-report-diff-fingerprint="..."
    >
      ...
    </article>
  </body>
</html>
```

- Exactly one `<article data-athena-landed-change-report="v2">` root.
- `data-athena-report-diff-fingerprint` / `-base` / `-head` are optional and
  keep whatever the delivery workflow stamped; other `data-athena-*`
  attributes are allowed as passthrough metadata.

## Forbidden everywhere

- `<style>`, `<script>`, `<link>`, `<iframe>`, `<img>`, `<svg>`, `<form>`,
  `<input>`, `<button>` — the app owns presentation and interactivity.
- Inline `style="..."` attributes.
- Inline event handlers (`onclick=` and any other `on*=`).
- `javascript:` URLs.
- Remote assets of any kind.

Allowed content markup: headings (`h1` only in the header, `h2` opens each
section, `h3`/`h4` inside), `p`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`
(`thead`/`tbody`/`tr`/`th`/`td`), `pre`, `code`, `strong`, `em`, `a`,
`blockquote`, `figure`, `figcaption`, `span`, `br`, `hr`. `class` attributes
are permitted but the app styles the contract's elements and data attributes,
not report-invented classes.

## Header

The article starts with:

```html
<header data-report-section="header">
  <h1>Report title</h1>
  <ul data-report-pills>
    <li>Delivery candidate</li>
    <li>Branch codex/...</li>
    <li>3,302 client tests green</li>
  </ul>
  <dl data-report-meta>
    <dt>PR</dt><dd>#737</dd>
    <dt>Status</dt><dd>Landed</dd>
  </dl>
</header>
```

- `<h1>` is required and must be the only `h1` in the file.
- `<ul data-report-pills>` is required with at least one `<li>` (status pills).
- `<dl data-report-meta>` is optional.

## Sections

Every other top-level child of the article is
`<section data-report-section="KEY">` whose first element child is an `<h2>`.

Required of **new** reports (one section each). Historical reports carry
whatever subset they originally had, plus any extra kebab-case keys:

| Key | Content |
| --- | --- |
| `summary` | Executive summary |
| `problem` | Problem/context in plain language |
| `mental-model` | Intuition, analogy, or layer map |
| `before-after` | Before vs after flow or layer breakdown |
| `key-files` | Key-file table (`<table>` required in this section) |
| `changes` | What changed and what intentionally did not |
| `validation` | Validation, review evidence, deploy/root-alignment status |
| `guidance` | Next-time workflow or operational guidance |
| `quiz` | Comprehension quiz (structure below) |
| `subagent-evidence` | Subagents used and what each contributed |

Additional sections (e.g. `failure-boundaries`, `mechanics`) are welcome with
any other kebab-case key. Order is up to the author except `quiz` and
`subagent-evidence`, which come last, in that order.

## Quiz

```html
<section data-report-section="quiz" data-quiz-pass-threshold="8">
  <h2>Comprehension quiz</h2>
  <p>Optional intro copy.</p>
  <ol data-quiz>
    <li data-quiz-question>
      <p data-quiz-prompt>Why did the zeroes go unreported for months?</p>
      <ol data-quiz-options>
        <li>They only appeared on mobile viewports.</li>
        <li data-quiz-correct>A zero reads as "nothing happened today".</li>
        <li>They were behind a feature flag.</li>
        <li>They only occurred after an hourly restore.</li>
      </ol>
      <p data-quiz-explanation>
        Missing data rendered identically to real data.
      </p>
    </li>
  </ol>
</section>
```

- `data-quiz-pass-threshold` is a required integer, `1 ≤ threshold ≤ questions`.
- At least 5 questions for a new report (the skill default remains 10 with
  threshold 8). Historical reports need at least 1.
- Each question has exactly one `data-quiz-correct` option, at least 2
  options, a `data-quiz-prompt`, and a `data-quiz-explanation`.
- **Do not number the prompt.** The rendered page numbers questions itself, so
  a prompt written as `1. Why …` displays as "1. 1. Why …". Write the question
  text alone.
- **Do not open the explanation by naming the answer** (`Correct: B.`). Options
  are not lettered on the rendered page, so the letter refers to nothing, and
  the page already marks the correct option. Start with the reasoning.
- No form controls in the markup — the app renders the interactive quiz and
  enforces the threshold.

## Historical note

v1 reports were standalone pages with embedded CSS and a scripted
`id="changeQuiz"` form, in several dialects: quiz answers lived on
`data-answer` attributes, in a script-side `answers` map or array, or in a
`QUESTIONS`/`QUIZ` array the page rendered at runtime. The corpus was migrated
to v2 in August 2026 by `scripts/migrate-reports-to-v2.mjs`, which moves prose
nodes rather than retyping them so wording is preserved exactly.

The app falls back to an isolated frame for any non-v2 file it encounters, but
the sensor fails the build on one, so that path should never be reachable.
