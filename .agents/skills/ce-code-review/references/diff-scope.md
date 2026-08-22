# Diff Scope Rules

These rules apply to every reviewer. They define what is "your code to review" versus pre-existing context.

## Scope Discovery

Determine the diff to review using this priority order:

1. **User-specified scope.** If the caller passed `BASE:`, `FILES:`, or `DIFF:` markers, use that scope exactly.
2. **Working copy changes.** If there are unstaged or staged changes (`git diff HEAD` is non-empty), review those.
3. **Unpushed commits vs base branch.** If the working copy is clean, review `git diff $(git merge-base HEAD <base>)..HEAD` where `<base>` is the default branch (main or master).

The scope step in the SKILL.md handles discovery and passes you the resolved diff. You do not need to run git commands yourself.

## Finding Classification Tiers

Every finding you report falls into one of three tiers based on its relationship to the diff:

### Primary (directly changed code)

Lines added or modified in the diff. This is your main focus. Report findings against these lines at full confidence.

### Secondary (immediately surrounding code)

Unchanged code within the same function, method, or block as a changed line. If a change introduces a bug that's only visible by reading the surrounding context, report it -- but note that the issue exists in the interaction between new and existing code.

### Pre-existing (unrelated to this diff)

Issues in unchanged code that the diff didn't touch and doesn't interact with. Mark these as `"pre_existing": true` in your output. They're reported separately and don't count toward the review verdict.

**The rule:** If you'd flag the same issue on an identical diff that didn't include the surrounding file, it's pre-existing. If the diff makes the issue *newly relevant* (e.g., a new caller hits an existing buggy function), it's secondary.

## Stay Inside The Diff, Add No Complexity

These rules apply to every reviewer and to synthesis. They exist because review loops ratchet: each round invites fresh scope on already-approved code and "defense in depth" additions, and the delivery grows without any new defect being fixed.

- **Anchor every finding to the diff.** A finding must cite a Primary line or a Secondary interaction the diff created. Observations about code the diff did not touch are pre-existing at best and usually non-findings.
- **Suggested fixes are the minimal change that closes the defect.** Do not propose a new abstraction, helper, wrapper, configuration knob, feature flag, rename, helper consolidation, or restructuring as the fix for a finding. If the minimal fix is a one-line guard or a corrected condition, propose exactly that.
- **No defense-in-depth findings.** Extra guards, redundant validation, "while we're here" hardening, or generalizing a branch to cases the delivery contract never named are not defects. They are `expansion` at most and usually fall under the false-positive catalog.
- **Do not re-review approved code.** In a later review round, only lines changed since the previously approved round are Primary. Code already present and approved earlier is Secondary context, not a fresh target.

The test: **if the delivery shipped exactly as written, would a user, caller, or operator hit a concrete defect?** If yes, report the defect and the smallest fix. If the honest answer is "no, but it would be cleaner / safer / more general", suppress it or route it to advisory.
