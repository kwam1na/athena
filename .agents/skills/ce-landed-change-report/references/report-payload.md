# Report Renderer Payload

`scripts/render_report.py` accepts a JSON object and writes a standalone HTML report.

## Minimal Shape

```json
{
  "title": "POS Local Sync Contract",
  "subtitle": "What changed and why",
  "metadata": ["PR #637", "Merged", "No production deploy"],
  "deliverableDiffFingerprint": "sha256 from `bun scripts/landed-change-report-check.ts --base origin/main --print-fingerprint`",
  "sections": [
    {
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

- `metadata` renders as compact pills.
- `deliverableDiffFingerprint` renders as `data-athena-report-diff-fingerprint` and must match the current deliverable diff for large-branch validation.
- `sections[].body` may be a string array or a single string.
- `sections[].bullets` may be an array of strings.
- `sections[].code` may be a string. Keep snippets short.
- `keyFiles` is optional but strongly recommended for code changes.
- `subagents` is required for normal use. If unavailable, include one entry with role `SubagentUnavailable` and an explanation.
- `quiz.passThreshold` should usually be 8 for a 10-question quiz.
- `quiz.questions[].answer` is a zero-based index into `options`.
