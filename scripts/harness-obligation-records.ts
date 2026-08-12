import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  HARNESS_REVIEW_IDENTITY_VERSION,
  type HarnessReviewIdentityVersion,
} from "./harness-review-identity";

export const HARNESS_OBLIGATION_RECORD_SCHEMA_VERSION = 1;
const RECORDS_GIT_PATH = "codex/harness-obligations/v1/records";

type SpawnedProcess = {
  exited: Promise<number>;
  stdout?: ReadableStream | null;
  stderr?: ReadableStream | null;
};

type CommandRunner = (
  command: string[],
  options: { cwd: string; stdout: "pipe"; stderr: "pipe" },
) => SpawnedProcess;

export type HarnessObligationCandidateBinding = {
  treeSha: string;
  deliverableTreeSha: string;
  identityVersion: HarnessReviewIdentityVersion;
  baseRef: string;
  baseTipSha: string;
  diffBaseSha: string;
};

export type HarnessReviewEvidenceResolution = {
  kind: "evidence";
  providerId: string;
  runId: string;
  finalPassId: string;
  manifestDigest: string;
  outcome: "green";
  blockingCount: 0;
  unresolvedActionableCount: 0;
  degradedReviewerCount: 0;
};

export type HarnessWaiverResolution = { kind: "waiver" };

export type HarnessObligationRecord = {
  schemaVersion: typeof HARNESS_OBLIGATION_RECORD_SCHEMA_VERSION;
  recordId: string;
  worktreeId: string;
  gateId: string;
  obligationId: string;
  candidate: HarnessObligationCandidateBinding;
  resolution: HarnessReviewEvidenceResolution | HarnessWaiverResolution;
  createdAt: string;
};

export type HarnessObligationRecordInput = Omit<
  HarnessObligationRecord,
  "schemaVersion" | "recordId" | "worktreeId" | "createdAt"
>;

export type HarnessObligationRecordDiagnostic =
  | { kind: "malformed_record"; path: string; reason: string }
  /**
   * A record written against an earlier candidate-identity version. It cannot
   * satisfy anything, but it is a version transition rather than tampering, so
   * it is reported without blocking the gate.
   */
  | { kind: "superseded_record"; path: string; reason: string }
  | { kind: "ignored_neighbor"; path: string };

type RecordRuntimeOptions = {
  storageDir?: string;
  spawn?: CommandRunner;
  now?: () => string;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function safeSlot(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function runGitPath(rootDir: string, spawn: CommandRunner = Bun.spawn) {
  const proc = spawn(["git", "rev-parse", "--git-path", RECORDS_GIT_PATH], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() ||
        stdout.trim() ||
        "failed to resolve Git-private obligation storage",
    );
  }
  const resolved = stdout.trim();
  return path.isAbsolute(resolved) ? resolved : path.resolve(rootDir, resolved);
}

export async function resolveHarnessObligationStorageContext(
  rootDir: string,
  options: RecordRuntimeOptions,
) {
  const storageDir = path.resolve(
    options.storageDir ?? (await runGitPath(rootDir, options.spawn)),
  );
  return { storageDir, worktreeId: digest(storageDir) };
}

function semanticIdentity(
  worktreeId: string,
  input: HarnessObligationRecordInput,
) {
  const resolutionIdentity =
    input.resolution.kind === "waiver"
      ? { kind: "waiver" }
      : {
          kind: "evidence",
          providerId: input.resolution.providerId,
          runId: input.resolution.runId,
          finalPassId: input.resolution.finalPassId,
          candidate: input.candidate,
        };
  return {
    schemaVersion: HARNESS_OBLIGATION_RECORD_SCHEMA_VERSION,
    worktreeId,
    gateId: input.gateId,
    obligationId: input.obligationId,
    candidate: input.candidate,
    resolution: resolutionIdentity,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseRecord(value: unknown): HarnessObligationRecord {
  if (!value || typeof value !== "object")
    throw new Error("record must be an object");
  const record = value as Partial<HarnessObligationRecord>;
  if (record.schemaVersion !== HARNESS_OBLIGATION_RECORD_SCHEMA_VERSION) {
    throw new Error("unsupported schema version");
  }
  if (
    !isNonEmptyString(record.recordId) ||
    !isNonEmptyString(record.worktreeId) ||
    !isNonEmptyString(record.gateId) ||
    !isNonEmptyString(record.obligationId) ||
    !isNonEmptyString(record.createdAt)
  ) {
    throw new Error("record identity is incomplete");
  }
  const candidate = record.candidate as
    Partial<HarnessObligationCandidateBinding> | undefined;
  if (
    !candidate ||
    !isNonEmptyString(candidate.treeSha) ||
    !isNonEmptyString(candidate.baseRef) ||
    !isNonEmptyString(candidate.baseTipSha) ||
    !isNonEmptyString(candidate.diffBaseSha)
  ) {
    throw new Error("candidate binding is incomplete");
  }
  const resolution = record.resolution as
    | Partial<HarnessReviewEvidenceResolution>
    | Partial<HarnessWaiverResolution>
    | undefined;
  if (resolution?.kind === "evidence") {
    if (
      !isNonEmptyString(resolution.providerId) ||
      !isNonEmptyString(resolution.runId) ||
      !isNonEmptyString(resolution.finalPassId) ||
      !isNonEmptyString(resolution.manifestDigest) ||
      resolution.outcome !== "green" ||
      resolution.blockingCount !== 0 ||
      resolution.unresolvedActionableCount !== 0 ||
      resolution.degradedReviewerCount !== 0
    ) {
      throw new Error("evidence resolution is not final green");
    }
  } else if (resolution?.kind !== "waiver") {
    throw new Error("invalid resolution discriminant");
  }
  return record as HarnessObligationRecord;
}

function renderRecord(record: HarnessObligationRecord) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

async function syncPath(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function publishHarnessObligationRecord(
  rootDir: string,
  input: HarnessObligationRecordInput,
  options: RecordRuntimeOptions = {},
) {
  const { storageDir, worktreeId } =
    await resolveHarnessObligationStorageContext(rootDir, options);
  const recordId = digest(semanticIdentity(worktreeId, input));
  const fileName = `${safeSlot(input.gateId)}--${safeSlot(input.obligationId)}--${recordId}.json`;
  const destination = path.join(storageDir, fileName);
  const record: HarnessObligationRecord = {
    schemaVersion: HARNESS_OBLIGATION_RECORD_SCHEMA_VERSION,
    recordId,
    worktreeId,
    ...input,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  const rendered = renderRecord(record);
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  await chmod(storageDir, 0o700);
  const temporary = path.join(
    storageDir,
    `.${recordId}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporary, rendered, { mode: 0o600, flag: "wx" });
    await syncPath(temporary);
    try {
      await link(temporary, destination);
      await syncPath(storageDir);
      return { ...record, record, path: destination };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existingText = await readFile(destination, "utf8");
      let existing: HarnessObligationRecord;
      try {
        existing = parseRecord(JSON.parse(existingText));
      } catch {
        throw new Error(
          `conflicting existing obligation record: ${destination}`,
        );
      }
      if (
        existing.recordId !== recordId ||
        digest(semanticIdentity(worktreeId, existing)) !== recordId
      ) {
        throw new Error(
          `conflicting existing obligation record: ${destination}`,
        );
      }
      return { ...existing, record: existing, path: destination };
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function discoverHarnessObligationRecords(
  rootDir: string,
  selector: {
    gateId: string;
    obligationId: string;
    storageDir?: string;
    spawn?: CommandRunner;
  },
) {
  const { storageDir, worktreeId } =
    await resolveHarnessObligationStorageContext(rootDir, selector);
  const records: HarnessObligationRecord[] = [];
  const diagnostics: HarnessObligationRecordDiagnostic[] = [];
  let entries: string[];
  try {
    entries = (await readdir(storageDir)).sort((left, right) =>
      left.localeCompare(right),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { records, diagnostics };
    throw error;
  }
  const prefix = `${safeSlot(selector.gateId)}--${safeSlot(selector.obligationId)}--`;
  for (const entry of entries) {
    const filePath = path.join(storageDir, entry);
    if (!entry.endsWith(".json")) {
      diagnostics.push({ kind: "ignored_neighbor", path: filePath });
      continue;
    }
    if (!entry.startsWith(prefix)) {
      diagnostics.push({ kind: "ignored_neighbor", path: filePath });
      continue;
    }
    try {
      const record = parseRecord(JSON.parse(await readFile(filePath, "utf8")));
      if (record.candidate.identityVersion !== HARNESS_REVIEW_IDENTITY_VERSION) {
        diagnostics.push({
          kind: "superseded_record",
          path: filePath,
          reason: `record was written against candidate identity ${record.candidate.identityVersion ?? "(none)"}; the current identity is ${HARNESS_REVIEW_IDENTITY_VERSION}`,
        });
        continue;
      }
      if (
        record.worktreeId !== worktreeId ||
        record.gateId !== selector.gateId ||
        record.obligationId !== selector.obligationId ||
        digest(semanticIdentity(worktreeId, record)) !== record.recordId
      ) {
        throw new Error("record identity does not match its slot");
      }
      records.push(record);
    } catch (error) {
      diagnostics.push({
        kind: "malformed_record",
        path: filePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { records, diagnostics };
}
