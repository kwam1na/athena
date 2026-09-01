import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { POLICY_PROJECTION_DIR } from "./policy-projection-check";

/**
 * The pre-cutover exactly-one-discovery guard for Athena's read-only shadow
 * window.
 *
 * The composed delivery product is installed in shadow mode and materializes
 * its run-pinned projection into managed delivery worktrees, while `bun run
 * pr:athena` stays the repository's only delivery authority. This guard holds
 * the five positions that window depends on, and holds nothing else:
 *
 *   - POSTURE. The activation metadata must still say shadow, and must not
 *     claim delivery authority.
 *   - BYTE-NEUTRALITY. The vendored discovery layout — the vendored generation
 *     tree and the host exposure symlinks that point into it — is pinned by
 *     digest over the index and checked again against the working tree, since
 *     the guard's real execution context is an operator's dirty tree during a
 *     live shadow install. No tracked byte of the layout moves before the
 *     cutover's removal gate, and nothing here edits or relocates one: the
 *     product's binding materializes its projection alongside the vendored
 *     generation and keeps it untracked with a worktree-scoped exclusion.
 *   - SCOPE. The projection root may exist only inside a managed delivery
 *     worktree. The repository root and every non-managed worktree keep the
 *     vendored generation authoritative. What is checked is the root of the
 *     tree the guard is invoked in, not every directory beneath it.
 *   - PIN EVIDENCE. The activation pins the candidate product at one commit,
 *     and its current characterization names that exact commit. A current
 *     explicit-input scorer observation is not a projection or policy-compile
 *     observation; the earlier scope characterization stays separately pinned
 *     to its own historical commit. The guard checks that historical charter
 *     references still describe the policy only as historical context. It
 *     never lets a newer product pin restamp that older materialization.
 *   - CONSUMPTION. While the gate record declares open pre-M1 blockers, every
 *     delivery is rejected before its marker can be considered. Once that list
 *     is empty, the existing per-entry source and shape checks govern. What
 *     keeps a session from writing the record is that `.agents` is a protected
 *     path in every checkpoint grant. After separately retaining and
 *     independently verifying and retaining the full observation artifact, the
 *     operator manually records only its derived summary outside those grants.
 *     That is a manual admission condition and operator assertion: this guard
 *     inspects only the recorded derived fields, not external retention, and
 *     cannot reject a summary solely because the external artifact is lost or
 *     unavailable. This MVP has no binding-side writer.
 *
 * The current sole proving host is qualified for strict exact Read but its
 * current-version discovery exclusivity is unverified. Ambient vendored
 * discovery alongside a managed projection is therefore diagnostic and
 * non-blocking while the shadow window holds no authority. Unsupported hosts
 * remain outside the lane; this guard neither admits them nor provides a
 * fallback.
 *
 * Both consumers of the grading therefore key on that affirmative value rather
 * than on the absence of the ungraded one. Keying on the absence would read a
 * grading the guard does not recognise as capable, and invent exactly the
 * blocking exclusivity claim this window is not allowed to make.
 *
 * Everything here is read-only: the guard opens files, asks git for tracked
 * object names, and returns typed findings.
 */
export const SHADOW_ACTIVATION_FILE = "shadow-activation.json";
export const SHADOW_GATE_RECORD_FILE = "shadow-milestone-gate-record.json";
/** The policy document whose lenses the recorded compilation must still describe. */
export const REPOSITORY_POLICY_FILE = "repository-policy.json";

/**
 * The vendored generation tree. Every tracked entry under it is part of the
 * layout whose bytes must not move before the removal gate.
 */
const VENDORED_GENERATION_TREE = ".agent-skills";

/**
 * The host discovery roots the vendored generation is exposed through. Only
 * the tracked SYMLINKS under them belong to the layout: those are the
 * generation's exposures. Ordinary repository-owned skills living beside them
 * are Athena's own content and change on their own schedule.
 */
const VENDORED_EXPOSURE_ROOTS = [".claude/skills", ".agents/skills"];

/** Git's symlink file mode, as `git ls-files -s` reports it. */
const SYMLINK_MODE = "120000";

/**
 * The pinned bytes of the vendored discovery layout. Changing the layout is a
 * deliberate two-place edit — the tracked bytes and this digest — rather than
 * a quiet drift that the shadow window would absorb.
 */
export const VENDORED_DISCOVERY_LAYOUT_DIGEST =
  "7d0269b5a180ccc96a1a706c9938b87cc366a9714ebdee713390d3cc483230d3";

export type ShadowGuardFindingCode =
  | "artifact_unreadable"
  | "activation_not_shadow"
  | "delivery_authority_claimed"
  | "exclusivity_position_unsupported"
  | "characterization_pin_mismatch"
  | "characterized_lenses_stale"
  | "vendored_layout_drift"
  | "projection_outside_managed_worktree"
  | "discovery_exclusivity_violation"
  | "consumption_record_missing"
  | "consumption_record_shape"
  | "agent_supplied_consumption_claim"
  | "pre_m1_blockers_open"
  | "comparison_set_admission_defect"
  | "comparison_set_mix_defect";

export type ShadowGuardObservationCode =
  | "exclusivity_non_blocking"
  | "comparison_set_incomplete";

export type ShadowGuardFinding = {
  code: ShadowGuardFindingCode;
  message: string;
};

export type ShadowGuardObservation = {
  code: ShadowGuardObservationCode;
  message: string;
};

export type ShadowGuardResult = {
  status: "pass" | "fail";
  findings: ShadowGuardFinding[];
  observations: ShadowGuardObservation[];
  countedDeliveryIds: string[];
};

/** What the guard was able to see about the tree it is judging. */
export type ObservedWorktree = {
  dir: string;
  projectionPresent: boolean;
  vendoredDiscoveryVisible?: boolean;
};

export type ShadowGuardOptions = {
  policyDir?: string;
  /** Overrides the git-derived layout digest; used to plant drift. */
  observedLayoutDigest?: string;
  /** Overrides the git-derived working-tree state of the layout. */
  observedLayoutWorkingTree?: string;
  /** Overrides the observation of the tree the guard runs in. */
  worktree?: ObservedWorktree;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function runGit(rootDir: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: rootDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString();
}

function trackedEntries(rootDir: string, paths: string[]) {
  return runGit(rootDir, ["ls-files", "-s", ...paths])
    .split("\n")
    .filter((line) => line.length > 0);
}

/**
 * The layout's canonical form: `git ls-files -s` lines — mode, object name,
 * stage, path — for the vendored generation tree plus the exposure symlinks,
 * sorted by code unit so the digest does not depend on locale collation.
 */
const exposureSymlinkEntries = (rootDir: string) =>
  trackedEntries(rootDir, VENDORED_EXPOSURE_ROOTS).filter((line) =>
    line.startsWith(`${SYMLINK_MODE} `),
  );

export async function computeVendoredDiscoveryLayoutDigest(rootDir: string) {
  const generation = trackedEntries(rootDir, [VENDORED_GENERATION_TREE]);
  const lines = [...generation, ...exposureSymlinkEntries(rootDir)].sort(
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  );
  return sha256(`${lines.join("\n")}\n`);
}

/**
 * The working-tree half of byte-neutrality. The digest above reads the index,
 * and the guard's real execution context is an operator's working tree during
 * a live shadow install — where an unstaged edit, or an exposure symlink
 * retargeted out of the vendored tree, is exactly the change the position
 * exists to catch and is invisible to the index.
 *
 * The pathspec is the layout's actual members, not the exposure roots. Those
 * roots also hold Athena's own skills, which change on their own schedule, and
 * a guard that fires on ordinary skill churn is one the operator learns to
 * ignore.
 */
export function vendoredDiscoveryLayoutPathspec(rootDir: string) {
  return [
    VENDORED_GENERATION_TREE,
    ...exposureSymlinkEntries(rootDir).map((line) =>
      line.slice(line.indexOf("\t") + 1),
    ),
  ];
}

export function observeVendoredDiscoveryLayoutWorkingTree(rootDir: string) {
  return runGit(rootDir, [
    "status",
    "--porcelain",
    "--",
    ...vendoredDiscoveryLayoutPathspec(rootDir),
  ]).trim();
}

/** Whether a path lies inside the declared managed delivery worktree root. */
function isManagedDeliveryWorktree(dir: string, managedRoot: string) {
  const wanted = managedRoot.split("/").filter((segment) => segment.length > 0);
  // An empty declared root would make every segment match vacuously, turning
  // the whole scope position off; a degenerate value narrows nothing.
  if (wanted.length === 0) return false;
  const segments = path.resolve(dir).split(path.sep);
  return segments.some((_, index) =>
    wanted.every((segment, offset) => segments[index + offset] === segment),
  );
}

function isHex64(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export async function runShadowDiscoveryGuard(
  rootDir: string,
  options: ShadowGuardOptions = {},
): Promise<ShadowGuardResult> {
  const findings: ShadowGuardFinding[] = [];
  const observations: ShadowGuardObservation[] = [];
  const countedDeliveryIds: string[] = [];
  const emit = (code: ShadowGuardFindingCode, message: string) => {
    findings.push({ code, message });
  };
  const observe = (code: ShadowGuardObservationCode, message: string) => {
    observations.push({ code, message });
  };

  const policyDir =
    options.policyDir ?? path.join(rootDir, POLICY_PROJECTION_DIR);

  const documents = new Map<string, any>();
  for (const file of [SHADOW_ACTIVATION_FILE, SHADOW_GATE_RECORD_FILE, REPOSITORY_POLICY_FILE]) {
    try {
      documents.set(
        file,
        JSON.parse(await readFile(path.join(policyDir, file), "utf8")),
      );
    } catch (error) {
      emit(
        "artifact_unreadable",
        `${POLICY_PROJECTION_DIR}/${file} is missing or not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const activation = documents.get(SHADOW_ACTIVATION_FILE);
  const gateRecord = documents.get(SHADOW_GATE_RECORD_FILE);
  const repositoryPolicy = documents.get(REPOSITORY_POLICY_FILE);
  if (
    activation === undefined ||
    gateRecord === undefined ||
    repositoryPolicy === undefined
  ) {
    return { status: "fail", findings, observations, countedDeliveryIds };
  }

  try {
    await evaluateShadowArtifacts({
      rootDir,
      options,
      activation,
      gateRecord,
      repositoryPolicy,
      countedDeliveryIds,
      emit,
      observe,
    });
  } catch (error) {
    // Valid JSON of the wrong shape is an unreadable artifact, not a crash —
    // the same policy the companion projection sensor applies.
    emit(
      "artifact_unreadable",
      `a shadow policy artifact does not have the expected shape, so the guard positions after this point were not evaluated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    observations,
    countedDeliveryIds,
  };
}

async function evaluateShadowArtifacts(input: {
  rootDir: string;
  options: ShadowGuardOptions;
  activation: any;
  gateRecord: any;
  repositoryPolicy: any;
  countedDeliveryIds: string[];
  emit: (code: ShadowGuardFindingCode, message: string) => void;
  observe: (code: ShadowGuardObservationCode, message: string) => void;
}) {
  const {
    rootDir,
    options,
    activation,
    gateRecord,
    repositoryPolicy,
    countedDeliveryIds,
    emit,
    observe,
  } = input;

  // ── Posture ───────────────────────────────────────────────────────────────
  if (activation.installationMode !== "shadow") {
    emit(
      "activation_not_shadow",
      `the activation declares installation mode ${JSON.stringify(
        activation.installationMode,
      )}; the guard only governs the read-only shadow window`,
    );
  }
  if (activation.deliveryAuthority !== "none") {
    emit(
      "delivery_authority_claimed",
      `the activation claims delivery authority ${JSON.stringify(
        activation.deliveryAuthority,
      )}; during the shadow window ${activation.comparisonAuthority} remains the only authority`,
    );
  }

  const provingHost = Array.isArray(activation.hosts)
    ? activation.hosts.find((host: any) => host?.hostId === activation.provingHost)
    : undefined;
  const provingHostExclusivityGraded =
    provingHost?.exclusivityGrading === "exclusivity-graded";
  const declaredPosition = activation.exclusivityPosition?.duringShadowWindow;
  // Only the affirmative capable grade admits a blocking claim. An ungraded
  // host, an unrecognised grading, and a proving host no entry grades all
  // refuse it: this is the one position that would otherwise widen on a value
  // it does not understand, and a claim the host cannot deliver is worse than
  // no claim.
  if (declaredPosition === "blocking" && !provingHostExclusivityGraded) {
    emit(
      "exclusivity_position_unsupported",
      `the activation claims a blocking exclusivity position while the proving host ${JSON.stringify(
        activation.provingHost,
      )} carries the grading ${JSON.stringify(
        provingHost?.exclusivityGrading,
      )}; only an exclusivity-graded host can deliver one`,
    );
  }

  // ── The pin and the evidence recorded about it ────────────────────────────
  //
  // The pin is a full object id, not an abbreviation: an abbreviated id names
  // a commit only until the repository grows one that shares its prefix, and
  // an installation that resolves to a different tree than the one
  // characterized is exactly what the evidence binding below exists to stop.
  const pin = activation.product?.commit;
  const characterizedPin = activation.characterization?.productCommit;
  if (typeof pin !== "string" || !/^[0-9a-f]{40}$/.test(pin)) {
    emit(
      "characterization_pin_mismatch",
      `the activation pins the product at ${JSON.stringify(
        pin,
      )}, which is not a full 40-character object id`,
    );
  } else if (characterizedPin !== pin) {
    // Evidence names the commit it was taken at. Moving the pin and leaving
    // the evidence behind leaves the activation describing a product nobody
    // observed, which is how the activation and the policy came to describe
    // incompatible worlds in the first place.
    emit(
      "characterization_pin_mismatch",
      `the activation pins the product at ${pin} and records a characterization observed at ${JSON.stringify(
        characterizedPin,
      )}; the recorded evidence is about one commit and the installation is about another, so re-run the characterization at the pinned commit rather than carrying the old observation forward`,
    );
  }
  if (
    activation.characterization?.kind === "explicit-scorer" &&
    activation.characterization?.observed?.scorerAuthority?.commit !== pin
  ) {
    emit(
      "characterization_pin_mismatch",
      `the activation pins the product at ${pin}, but its explicit scorer observation names ${JSON.stringify(
        activation.characterization?.observed?.scorerAuthority?.commit,
      )}; rerun the scorer from the pinned product before carrying its result into this activation`,
    );
  }

  // The compilation the characterization recorded is what says this
  // repository's policy is compilable by the pinned product at all. It is
  // evidence about the lens set that existed when it ran, so a lens the
  // document has since added, dropped, or re-pointed leaves it describing a
  // policy this repository no longer carries.
  const lensIdentity = (lens: any) =>
    JSON.stringify([lens?.lensId ?? null, lens?.category ?? null, lens?.personaId ?? null]);
  const sorted = (lenses: any[]) => lenses.map(lensIdentity).sort();
  // A policy document or a recorded compilation of the wrong shape throws out
  // of `sorted` and lands in this function's shared catch as an unreadable
  // artifact — the same policy every other position here applies, and one
  // fewer bespoke throw to keep witnessed.
  const declaredLenses: any[] = repositoryPolicy.reviewLenses;
  const historicalScope = activation.characterization?.historicalScopeCharacterization;
  const compiledLenses: any[] =
    activation.characterization?.kind === "explicit-scorer"
      ? historicalScope?.observed?.policyCompilation?.resolvedLenses ?? []
      : activation.characterization?.observed?.policyCompilation?.resolvedLenses ?? [];
  const declared = sorted(declaredLenses);
  const compiled = sorted(compiledLenses);
  if (
    declared.length !== compiled.length ||
    declared.some((entry, index) => entry !== compiled[index])
  ) {
    emit(
      "characterized_lenses_stale",
      `the characterization at ${JSON.stringify(
        activation.characterization?.kind === "explicit-scorer"
          ? historicalScope?.productCommit
          : characterizedPin,
      )} records resolving ${JSON.stringify(
        compiled,
      )}, and ${POLICY_PROJECTION_DIR}/${REPOSITORY_POLICY_FILE} now declares ${JSON.stringify(
        declared,
      )}; a lens the recorded characterization was never shown to resolve is a charter reference with no evidence behind it, so recompile against the relevant product pin and record what it resolved`,
    );
  }

  // ── Byte-neutrality of the vendored discovery layout ──────────────────────
  let observedLayoutDigest = options.observedLayoutDigest;
  if (observedLayoutDigest === undefined) {
    try {
      observedLayoutDigest = await computeVendoredDiscoveryLayoutDigest(rootDir);
    } catch (error) {
      emit(
        "artifact_unreadable",
        `the vendored discovery layout could not be read from git: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (
    observedLayoutDigest !== undefined &&
    observedLayoutDigest !== VENDORED_DISCOVERY_LAYOUT_DIGEST
  ) {
    emit(
      "vendored_layout_drift",
      `the vendored discovery layout hashes to ${observedLayoutDigest}, not the pinned ${VENDORED_DISCOVERY_LAYOUT_DIGEST}; no tracked byte of it may change before the cutover's removal gate, and a deliberate change is re-pinned by updating VENDORED_DISCOVERY_LAYOUT_DIGEST in scripts/shadow-discovery-guard.ts`,
    );
  }
  let workingTree = options.observedLayoutWorkingTree;
  if (workingTree === undefined) {
    try {
      workingTree = observeVendoredDiscoveryLayoutWorkingTree(rootDir);
    } catch (error) {
      emit(
        "artifact_unreadable",
        `the vendored discovery layout's working-tree state could not be read from git: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (workingTree !== undefined && workingTree.length > 0) {
    emit(
      "vendored_layout_drift",
      `the vendored discovery layout is modified in the working tree, which the index digest cannot see (a deliberate change is committed and then re-pinned by updating VENDORED_DISCOVERY_LAYOUT_DIGEST in scripts/shadow-discovery-guard.ts):\n${workingTree}`,
    );
  }

  // ── Projection scope and discovery coexistence ────────────────────────────
  const projectionRoot = activation.projection?.root ?? ".managed-projection";
  const managedRoot =
    activation.projection?.managedDeliveryWorktreeRoot ?? ".worktrees/managed";
  const worktree: ObservedWorktree = options.worktree ?? {
    dir: rootDir,
    projectionPresent: existsSync(path.join(rootDir, projectionRoot)),
    vendoredDiscoveryVisible: existsSync(
      path.join(rootDir, VENDORED_GENERATION_TREE),
    ),
  };
  const managed = isManagedDeliveryWorktree(worktree.dir, managedRoot);
  if (worktree.projectionPresent && !managed) {
    emit(
      "projection_outside_managed_worktree",
      `${worktree.dir} carries ${projectionRoot} but is not a managed delivery worktree under ${managedRoot}; the repository root and non-managed worktrees keep the vendored generation authoritative`,
    );
  }
  if (worktree.projectionPresent && worktree.vendoredDiscoveryVisible) {
    // Both consumers of the grading key on the same affirmative value. Keying
    // this one on the absence of the ungraded token would read an unrecognised
    // grading as capable and emit the blocking exclusivity claim the shadow
    // window is specifically not allowed to invent.
    if (provingHostExclusivityGraded) {
      emit(
        "discovery_exclusivity_violation",
        `${worktree.dir} exposes both the run-pinned projection and the ambient vendored generation while the proving host ${JSON.stringify(
          activation.provingHost,
        )} is graded exclusivity-graded; discovery must resolve to the run-pinned projection alone`,
      );
    } else {
      observe(
        "exclusivity_non_blocking",
        `${worktree.dir} exposes both the run-pinned projection and the ambient vendored generation; the proving host ${JSON.stringify(
          activation.provingHost,
        )} carries the grading ${JSON.stringify(
          provingHost?.exclusivityGrading,
        )}, which is not the capable grade, so coexistence is non-blocking during the read-only shadow window and hard exclusivity arrives at ${activation.exclusivityPosition?.becomesBlockingAt}`,
      );
    }
  }

  // ── Derived summaries only; external artifact retention is not inspected ──
  const requirement = gateRecord.comparisonSetRequirement ?? {};
  const requiredMix: Record<string, number> = requirement.mix ?? {};
  const deliveries: any[] = Array.isArray(gateRecord.deliveries)
    ? gateRecord.deliveries
    : [];
  const countedByCategory = new Map<string, number>();
  const openPreM1Blockers = gateRecord.openPreM1Blockers;
  const blockerListValid = Array.isArray(openPreM1Blockers);

  if (!blockerListValid) {
    emit(
      "artifact_unreadable",
      "the gate record's openPreM1Blockers field must be an explicit list; admission fails closed until the list can be read",
    );
  } else if (openPreM1Blockers.length > 0 && deliveries.length > 0) {
    emit(
      "pre_m1_blockers_open",
      `the gate record still lists open pre-M1 blockers ${openPreM1Blockers.join(
        ", ",
      )}; no delivery may be recorded or counted until the list is empty`,
    );
  }

  const deliveriesToEvaluate =
    blockerListValid && openPreM1Blockers.length === 0 ? deliveries : [];
  for (const delivery of deliveriesToEvaluate) {
    const id = String(delivery?.id ?? "<unnamed>");
    const record = delivery?.projectionConsumption;
    let admissible = false;

    if (record === undefined || record === null) {
      emit(
        "consumption_record_missing",
        `delivery ${id} carries no projection-consumption record, so it cannot count toward the comparison set`,
      );
    } else if (record.source !== "binding") {
      emit(
        "agent_supplied_consumption_claim",
        `delivery ${id} carries a derived projection-consumption summary with literal source ${JSON.stringify(
          record.source,
        )}; the guard requires the literal value "binding" but does not independently verify qualified-adapter provenance, so the operator must assert that provenance before recording a counted summary`,
      );
    } else if (record.affirmative === false) {
      // An honest negative: the run did not consume the run-pinned projection.
      // Excluded from the comparison set, and not a defect.
    } else if (record.affirmative !== true) {
      emit(
        "consumption_record_shape",
        `delivery ${id} has a projection-consumption record whose affirmative flag is ${JSON.stringify(
          record.affirmative,
        )}; it must be an explicit boolean`,
      );
    } else if (!isHex64(record.projectionDigest)) {
      emit(
        "consumption_record_shape",
        `delivery ${id} affirms consumption without the projection digest derived from the separately retained and independently verified full artifact`,
      );
    } else if (typeof delivery?.id !== "string" || delivery.id.length === 0) {
      emit(
        "consumption_record_shape",
        "a gate-record entry with no delivery id cannot be tied to any run, so its marker proves nothing",
      );
    } else if (record.marker?.deliveryId !== delivery.id) {
      emit(
        "consumption_record_shape",
        `delivery ${id} carries a marker naming ${JSON.stringify(
          record.marker?.deliveryId,
        )}; a marker from another run proves nothing about this one`,
      );
    } else if (typeof record.marker?.fence !== "number") {
      emit(
        "consumption_record_shape",
        `delivery ${id} carries a marker without the numeric invocation fence that binds it to this run`,
      );
    } else if (
      typeof record.marker?.consumed !== "string" ||
      record.marker.consumed.length === 0
    ) {
      emit(
        "consumption_record_shape",
        `delivery ${id} carries a marker that names no consumed workflow source`,
      );
    } else {
      admissible = true;
    }

    if (delivery?.countedInComparisonSet === true) {
      if (!admissible) {
        emit(
          "comparison_set_admission_defect",
          `delivery ${id} is counted in the comparison set without a shape-valid derived consumption summary: literal source "binding", affirmative true, digest, and marker are required; the guard cannot independently verify adapter provenance after summarization`,
        );
      } else if (countedDeliveryIds.includes(id)) {
        // One run counted twice fills the comparison set without measuring a
        // second delivery; the marker binds a delivery, so the id is the run.
        emit(
          "comparison_set_admission_defect",
          `delivery ${id} is counted more than once; each counted delivery must be a distinct run`,
        );
      } else {
        countedDeliveryIds.push(id);
        const category = String(delivery?.category ?? "<uncategorised>");
        countedByCategory.set(
          category,
          (countedByCategory.get(category) ?? 0) + 1,
        );
      }
    }
  }

  for (const [category, count] of countedByCategory) {
    // Own properties only: a category named after an Object.prototype member
    // would otherwise resolve through the prototype chain and skip the cap.
    const allowed = Object.hasOwn(requiredMix, category)
      ? requiredMix[category]
      : undefined;
    if (allowed === undefined) {
      emit(
        "comparison_set_mix_defect",
        `the comparison set counts a ${category} delivery, which the baseline mix does not include`,
      );
    } else if (count > allowed) {
      emit(
        "comparison_set_mix_defect",
        `the comparison set counts ${count} ${category} deliveries against the baseline's ${allowed}; the set must match the baseline's mix and count`,
      );
    }
  }
  const requiredTotal = Number(requirement.total ?? 0);
  // Written as a negated `>=` so an unparseable total falls to the incomplete
  // side: NaN makes every comparison false, and silently dropping the
  // observation would let a malformed requirement read as a scorable set.
  if (!(countedDeliveryIds.length >= requiredTotal)) {
    observe(
      "comparison_set_incomplete",
      `the comparison set holds ${countedDeliveryIds.length} of the ${requiredTotal} deliveries the baseline mix requires; the shadow-delivery gate cannot be scored until it is complete`,
    );
  }
}

if (import.meta.main) {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const result = await runShadowDiscoveryGuard(rootDir);
  if (result.status === "pass") {
    console.log(
      "[shadow-discovery-guard] Shadow-window posture holds: shadow-mode activation, characterization evidence bound to the pinned product and the declared lenses, byte-neutral vendored discovery layout, projection scoped to managed delivery worktrees, and the pre-M1 admission interlock intact.",
    );
  } else {
    console.log(
      `[shadow-discovery-guard] Found ${result.findings.length} guard finding(s):`,
    );
    for (const finding of result.findings) {
      console.log(`  - [${finding.code}] ${finding.message}`);
    }
  }
  for (const observation of result.observations) {
    console.log(`  · [${observation.code}] ${observation.message}`);
  }
  process.exitCode = result.status === "pass" ? 0 : 1;
}
