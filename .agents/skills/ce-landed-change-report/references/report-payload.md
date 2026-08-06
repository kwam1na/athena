# Report Renderer Payload

`scripts/render_report.py` accepts a JSON object and writes a contract-v2
semantic HTML report (see `report-html-contract.md`). Every section needs a
`key` matching the contract's `data-report-section` vocabulary; the required
keys are `summary`, `problem`, `mental-model`, `before-after`, `changes`,
`validation`, and `guidance` (`key-files`, `quiz`, and `subagent-evidence` are
built from their own payload fields).

## Minimal Shape

```json
{
  "title": "POS Local Sync Contract",
  "subtitle": "What changed and why",
  "metadata": ["PR #637", "Merged", "No production deploy"],
  "deliverableDiffFingerprint": "sha256 from `bun scripts/landed-change-report-check.ts --base origin/main --print-fingerprint`",
  "meta": { "PR": "#637", "Status": "Landed" },
  "sections": [
    {
      "key": "summary",
      "title": "Executive Summary",
      "body": ["Paragraph one.", "Paragraph two."]
    }
  ],
  "keyFiles": [
    {
      "path": "packages/example.ts",
      "purpose": "Explains why this file matters."
    }
  ],
  "subagents": [
    {
      "role": "session context",
      "summary": "Gathered prior decisions and finish-line changes."
    }
  ],
  "quiz": {
    "passThreshold": 8,
    "questions": [
      {
        "question": "What changed?",
        "options": ["Wrong", "Correct", "Wrong"],
        "answer": 1,
        "explanation": "The correct answer explains the operational boundary."
      }
    ]
  }
}
```

## Field Notes

- `sections[].key` is required and must be kebab-case; unknown keys render as
  extra sections placed before the quiz.
- `metadata` renders as the required `data-report-pills` status pills.
- `meta` (optional) renders as a `data-report-meta` definition list.
- `deliverableDiffFingerprint` renders as `data-athena-report-diff-fingerprint` and must match the current deliverable diff for large-branch validation.
- `sections[].body` may be a string array or a single string.
- `sections[].bullets` may be an array of strings.
- `sections[].code` may be a string. Keep snippets short.
- `keyFiles` is optional but strongly recommended for code changes.
- `subagents` is required for normal use. If unavailable, include one entry with role `SubagentUnavailable` and an explanation.
- `quiz.passThreshold` should usually be 8 for a 10-question quiz.
- `quiz.questions[].answer` is a zero-based index into `options`.
