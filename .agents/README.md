# Athena Local Agent Skills

This directory vendors the local agent skill system used to deliver Athena work.

## Contents

- `skills/` contains repo-local agent skills.
- `agents/` contains Compound Engineering reviewer, researcher, and worker agent prompts used by the copied skills.
- `plugin-metadata/` preserves the Compound Engineering plugin manifests that describe the upstream plugin bundle.

## Vendored Sources

- skill directories from `/Users/kwamina/.codex/skills`
- `/Users/kwamina/.codex/superpowers/skills`
- `/Users/kwamina/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.3.1/skills`
- `/Users/kwamina/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.3.1/agents`

Root-level helper/test/system directories from `/Users/kwamina/.codex/skills` are intentionally not copied unless they are an actual skill directory with a `SKILL.md`.

The older Athena-specific Claude skills remain in `packages/.claude/skills/` for now:

- `linear-athena-ticketing`
- `executing-athena-linear-tickets`

When refreshing this vendor copy, keep repo-specific skills unless intentionally replacing them.
