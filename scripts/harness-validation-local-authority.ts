import {
  createHealthApprovalVerifier,
  HEALTH_READ_TIMEOUT_MS,
  readValidationHealth,
  runHealthProcess,
  type HealthPolicy,
  type HealthReaderOptions,
} from "./harness-validation-health.ts";
import {
  parseValidationHealthInventory,
  VALIDATION_HEALTH_INVENTORY_PATH,
} from "./harness-validation-health-inventory.ts";

// Shared with the hosted adapters; no hosted run identity is fabricated locally.
export const HEALTH_WORKFLOW_PATH =
  ".github/workflows/athena-validation-health.yml";
export const HEALTH_ARTIFACT_NAME = "athena-validation-health";
export const HEALTH_CLASSIFICATION_PATH =
  ".agents/validation-health-classifications.json";

export class LocalValidationAuthorityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LocalValidationAuthorityError";
  }
}
export type LocalValidationAuthorityOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: number;
  readOrigin?: (rootDir: string, signal: AbortSignal) => Promise<string>;
  requestJson?: (endpoint: string, signal: AbortSignal) => Promise<unknown>;
  readHealth?: typeof readValidationHealth;
  loadArtifact?: HealthReaderOptions["loadArtifact"];
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const fail = (code: string, message: string): never => {
  throw new LocalValidationAuthorityError(code, message);
};

function originRepository(origin: string): string {
  const value = origin.trim();
  const match =
    /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
      value,
    );
  if (
    !match ||
    match[1].split("/").some((part) => part === "." || part === "..")
  )
    return fail(
      "local_health_origin_invalid",
      "Origin must identify a GitHub repository.",
    );
  return match[1];
}

/** Bound even injected transports that do not cooperate with cancellation. */
async function abortable<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted)
    return fail(
      "local_health_authority_cancelled",
      "Local health authority read was cancelled or timed out.",
    );
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        new LocalValidationAuthorityError(
          "local_health_authority_cancelled",
          "Local health authority read was cancelled or timed out.",
        ),
      );
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(read)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
const readOrigin = async (rootDir: string, signal: AbortSignal) => {
  const result = await runHealthProcess(
    ["git", "-C", rootDir, "remote", "get-url", "origin"],
    signal,
  );
  if (result.exitCode !== 0)
    return fail(
      "local_health_origin_unavailable",
      "Git origin is unavailable.",
    );
  return result.stdout.toString("utf8");
};
const requestJson = async (
  endpoint: string,
  signal: AbortSignal,
): Promise<unknown> => {
  const result = await runHealthProcess(
    ["gh", "api", "--hostname", "github.com", endpoint],
    signal,
  );
  if (result.exitCode !== 0)
    return fail(
      "local_health_authority_unavailable",
      "Authenticated GitHub metadata is unavailable.",
    );
  return JSON.parse(result.stdout.toString("utf8")) as unknown;
};

/** Reads protected-main metadata only. Missing history can request full recovery;
 * missing trust metadata cannot be replaced with candidate files or an empty policy. */
export async function readLocalValidationAuthority(
  rootDir: string,
  options: LocalValidationAuthorityOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? HEALTH_READ_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    return fail(
      "local_health_authority_timeout_invalid",
      "Authority timeout must be between 1 and 60000 milliseconds.",
    );
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  const started = Date.now();
  const request = (endpoint: string, innerSignal?: AbortSignal) => {
    const combined = innerSignal
      ? AbortSignal.any([signal, innerSignal])
      : signal;
    return abortable(
      () => (options.requestJson ?? requestJson)(endpoint, combined),
      combined,
    );
  };
  const origin = () =>
    abortable(
      () => (options.readOrigin ?? readOrigin)(rootDir, signal),
      signal,
    );
  try {
    const repository = originRepository(await origin());
    const base = `/repos/${repository}`;
    const repo = await request(base);
    if (
      !object(repo) ||
      typeof repo.full_name !== "string" ||
      repo.full_name.toLowerCase() !== repository.toLowerCase() ||
      typeof repo.default_branch !== "string" ||
      !repo.default_branch.trim()
    )
      return fail(
        "local_health_repository_invalid",
        "Authenticated repository/default branch does not match origin.",
      );
    const defaultBranch = repo.default_branch;
    const mainEndpoint = `${base}/commits/${encodeURIComponent(defaultBranch)}`;
    const workflowEndpoint = `${base}/actions/workflows/${HEALTH_WORKFLOW_PATH.split("/").at(-1)}`;
    const main = await request(mainEndpoint);
    if (!object(main) || !sha(main.sha))
      return fail(
        "local_health_main_invalid",
        "Protected default branch commit is unavailable.",
      );
    const mainSha = main.sha;
    const workflow = await request(workflowEndpoint);
    if (
      !object(workflow) ||
      !Number.isSafeInteger(workflow.id) ||
      Number(workflow.id) < 1 ||
      workflow.path !== HEALTH_WORKFLOW_PATH ||
      workflow.state !== "active"
    )
      return fail(
        "local_health_workflow_invalid",
        "Expected active health workflow is unavailable.",
      );
    const contents = await request(
      `${base}/contents/${VALIDATION_HEALTH_INVENTORY_PATH}?ref=${mainSha}`,
    );
    if (
      !object(contents) ||
      contents.type !== "file" ||
      contents.path !== VALIDATION_HEALTH_INVENTORY_PATH ||
      !sha(contents.sha) ||
      contents.encoding !== "base64" ||
      typeof contents.content !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        contents.content.replace(/\s/g, ""),
      )
    )
      return fail(
        "local_health_inventory_invalid",
        "Protected-main health inventory content is missing or malformed.",
      );
    let inventory;
    try {
      inventory = parseValidationHealthInventory(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.from(contents.content, "base64"),
          ),
        ),
      );
    } catch {
      return fail(
        "local_health_inventory_invalid",
        "Protected-main health inventory failed strict schema validation.",
      );
    }
    const policy: HealthPolicy = {
      repository,
      defaultBranch,
      workflowId: Number(workflow.id),
      workflowPath: HEALTH_WORKFLOW_PATH,
      artifactName: HEALTH_ARTIFACT_NAME,
      classificationPath: HEALTH_CLASSIFICATION_PATH,
      checks: inventory.checks.map(({ checkId, scope }) => ({
        checkId,
        scope,
      })),
    };
    let mainMoved = false;
    const pinnedRequest = async (
      endpoint: string,
      innerSignal?: AbortSignal,
    ) => {
      const value = await request(endpoint, innerSignal);
      if (
        endpoint === mainEndpoint &&
        (!object(value) || value.sha !== mainSha)
      ) {
        mainMoved = true;
        return fail(
          "local_health_authority_changed",
          "Default branch moved during the health read.",
        );
      }
      return value;
    };
    const healthOptions: HealthReaderOptions = {
      signal,
      timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)),
      requestJson: pinnedRequest,
      verifyClassificationApproval: createHealthApprovalVerifier(
        policy,
        pinnedRequest,
      ),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.loadArtifact
        ? {
            loadArtifact: (repo, id, innerSignal) => {
              const combined = innerSignal
                ? AbortSignal.any([signal, innerSignal])
                : signal;
              return abortable(
                () => options.loadArtifact!(repo, id, combined),
                combined,
              );
            },
          }
        : {}),
    };
    const health = await abortable(
      () => (options.readHealth ?? readValidationHealth)(policy, healthOptions),
      signal,
    );
    const finalRepo = await request(base),
      finalMain = await request(mainEndpoint),
      finalWorkflow = await request(workflowEndpoint);
    if (
      mainMoved ||
      originRepository(await origin()) !== repository ||
      !object(finalRepo) ||
      finalRepo.full_name !== repo.full_name ||
      finalRepo.default_branch !== defaultBranch ||
      !object(finalMain) ||
      finalMain.sha !== mainSha ||
      !object(finalWorkflow) ||
      finalWorkflow.id !== workflow.id ||
      finalWorkflow.path !== HEALTH_WORKFLOW_PATH ||
      finalWorkflow.state !== "active"
    )
      return fail(
        "local_health_authority_changed",
        "Origin, protected main or workflow identity changed during health collection.",
      );
    return { health, inventory, repository, mainSha, policy };
  } catch (error) {
    if (error instanceof LocalValidationAuthorityError) throw error;
    return fail(
      "local_health_authority_unavailable",
      "Could not authenticate local validation health authority.",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
