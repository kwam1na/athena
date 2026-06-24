# Athena Local Agent Skills

This directory vendors the local agent skill system used to deliver Athena work.

## Source of Truth

Athena agents should resolve workflow behavior from this directory first. When a skill exists under `skills/`, use that repo-local copy instead of any matching global Codex skill, plugin-cache skill, marketplace skill, or Superpowers skill.

Linear planning and ticket execution use the repo-local `track` and `execute` skills.

Global connectors and platform tools may still provide runtime capabilities, but they are not the source of Athena workflow policy.

## Contents

- `skills/` contains repo-local agent skills.
- `agents/` contains Compound Engineering reviewer, researcher, and worker agent prompts used by the copied skills.
- `plugin-metadata/` preserves the Compound Engineering plugin manifests that describe the upstream plugin bundle.

## Vendored Sources

- selected skill directories from `/Users/kwamina/.codex/skills`
- selected skill directories from `/Users/kwamina/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.3.1/skills`
- selected agent prompts from `/Users/kwamina/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.3.1/agents`

Root-level helper/test/system directories from `/Users/kwamina/.codex/skills` are intentionally not copied unless they are an actual skill directory with a `SKILL.md`.

When refreshing this vendor copy, keep repo-specific skills unless intentionally replacing them.
