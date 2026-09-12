# Affected consumer qualification

Run either example from the repository root:

```sh
bun run harness:plan -- --input scripts/fixtures/affected-validation/impact/frontend-request.json --json
bun run harness:plan -- --input scripts/fixtures/affected-validation/impact/report-request.json --json
```

The frontend example selects the image utility test without the unrelated test. The report example selects only plan-integrity and docs-publishing obligations. Both emit `athena-validation-plan/1`, retain `authority: legacy-gate`, and report evidence as `not-evaluated`.

The programmatic entrypoint is `buildValidationPlan(registry, changes, mode, snapshots)` in `scripts/harness-validation-plan.ts`. `collectCanonicalValidationRegistry(inventory)` supplies the authored Athena policy. Optional `snapshots` contains complete repo-relative regular-file textual `base` and `candidate` maps; the inventory must describe the same candidate. Supply every semantic change, including old rename paths. Missing changed inputs, undeclared textual differences, invalid policy, and uncovered changes block planning. Callers own snapshot completeness and actual byte capture; this interface does not inspect Git or execute checks.

`resolveValidationImpact` combines reverse dependencies from both snapshots with `VALIDATION_RUNTIME_RELATIONSHIPS`. Runtime relationship and fallback declarations are policy, not proof inferred from passing tests. Unsupported dependencies keep named conservative fallback reasons. The docs filesystem exception is valid only for its characterized source hash.

Each canonical check retains its argv, cwd, profile, prerequisites, supersession, and reasons. Unit `membership` is the candidate test set selected for execution. `inputs` and `absentInputs` separately declare candidate dependencies and required absence. Unknown runtime consumers may retain narrow membership with broad input declarations. Package-wide checks bind their package and relevant configuration; ownership comes from the package profile before command cwd. Package typechecks do not inherit publishing HTML as runtime input. Full-health keeps the complete registered obligations and candidate test membership.

The execution owner must capture dependency installation, toolchain/runtime, environment, and actual input bytes in its product profile. This planner neither grants cross-run evidence reuse nor activates affected execution. V26-2024 owns execution integration; do not treat this fixture output as a passing sensor or cache receipt.

Runtime data contracts distinguish raw source inspection from module execution. Their exact reader hashes and any configuration guards must match. A raw read binds file bytes and membership but does not execute imports written inside those bytes. The snapshot owner must reject escaping or unqualified symlinks in characterized reader roots, or include and validate the resolved targets and membership; a textual map alone cannot establish physical containment. Installed dependency bytes remain the execution owner's explicit inputs.

Selected unit checks are grouped into report-independent and report-dependent partitions, using each member's actual conservative input contract. The latter use a `.publishing` check-ID suffix while retaining the unit execution profile. Original prerequisites, supersession and required selections are remapped to the resulting groups. This allows an accumulated code-plus-report plan to preserve unrelated unit identities while retaining checks that really load the report corpus. The suffix denotes a dependency, not proof of a passed publishing check. Full-health remains complete and conservative.
