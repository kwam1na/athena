# U8 qualification corpus

Run the new cross-step controls with:

```sh
bun test scripts/harness-validation-qualification.test.ts
```

`qualification-corpus.ts` exports fresh scenario objects, including semantic changes,
base/candidate textual snapshots and canonical registry declarations. Call the landed
`buildValidationPlan` with these objects to obtain comparison or matched full-health
plans. The scenarios are synthetic. They do not establish actual Athena narrowing,
product evidence reuse, hosted acceptance or performance improvement.

The test executes one synthetic selected/full pair in disposable directories. Both
clean executions pass; changing `value` to 99 makes both executions fail the same
`value contract`. It also checks accumulated code plus modified/new reports, a
consumer introduced by a new base but absent from old registry membership, and
refusal after deleting the explicit report dependency contract. A stale pre-rebase
plan fails the new consumer membership oracle. No receipts or execution cache are
created.

## Twelve-family coverage and remaining acceptance

Existing test names below refer to `scripts/harness-validation-impact.test.ts`
unless another file is named. They are retained rather than copied into this suite.

| Family | Existing or new planner control | Remaining final acceptance |
| --- | --- | --- |
| Report-only | New `reportOnlyScenario`; existing genuine/unknown report readers | Run publishing consumers; zero unrelated application tests through native product |
| Report follow-up, including new report | New `reportFollowupScenarios` and cross-step identity/input assertions | Preserve original execution provenance for independent obligations; execute changed publishing inputs |
| Isolated UI | Existing `frontend-request.json` and runnable CLI example test | Real repository selected/full fault controls and narrowing, not the synthetic counter fixture |
| Shared helper/alias | Existing workspace exports/JSONC aliases and reverse re-export tests | Actual selected/full shared-consumer fault controls |
| Convex literal | Existing characterized lazy Convex registry/literal reference test | Actual selected/full backend execution with supported runtime profile |
| Convex unknown | Existing eager/wrapped/computed fallback cases | Execute named containing fallback and prove the injected fault fails it |
| Setup/toolchain | Existing implicit runner setup/config tests; planner inventory identity test | Native dependency/toolchain/profile invalidation and preparation-before-review refusal |
| Deletion | Existing deleted tests, omitted paths and former consumer tests | Execute containing obligation or refuse missing coverage; preserve absence evidence |
| Rename | Existing both-path rename and Bun directory-reader cases | Actual old/new path invalidation and consumer execution |
| Base-added consumer | New `baseMovementScenarios` with unchanged delivery diff and old registry | Native base-binding invalidation, fresh capture and actual consumer execution |
| Partial late failure | No planner-only success claim | Product executor: retain earlier success, refuse failed/missing proof, rerun failed member, portable verification |
| Empty-diff full health | Existing `does not narrow full-health membership` and complete input scope tests | Execute full inventory for a new trusted health run; hosted seed/cold reader, approval and revision-race controls |

The integration owner retains runtime, health, real-repository and hosted fixtures.
The final U8 run must retain selected IDs, membership, profiles, reasons/fallbacks,
captured candidate/base identities and actual execution/result references for each
applicable family. It must also prove directory/symlink capture refusal and guarded
reader/source mutation behavior through their owning layers.

Timing remains unmeasured here. Use at least three matched repetitions per chosen
expensive representative case, count dependency/setup and health lookup costs, and
report contention and warm/cold state. Separate actual execution from reuse; planner
identity equality alone is not product acceptance. Keep legacy authority until the
separate activation decision and qualify force-full rollback through the same planner.
