import { readdir } from "node:fs/promises";
import path from "node:path";

type SpawnedProcess = {
  exited: Promise<number>;
};

type WorkflowCheckOptions = {
  spawn?: (
    command: string[],
    options: { cwd: string; stdout: "inherit"; stderr: "inherit" },
  ) => SpawnedProcess;
  logger?: Pick<Console, "log">;
};

const WORKFLOW_DIRECTORY = ".github/workflows";
const WORKFLOW_FILE_PATTERN = /\.ya?ml$/i;

/** This runs from the caller's trusted checkout against the supplied root. The
 * pinned-base guard can therefore inspect candidate workflow wiring without
 * executing a candidate-owned workflow checker. */
export const AFFECTED_WORKFLOW_CONTRACT = `
pr = YAML.load_file('.github/workflows/athena-pr-tests.yml')
health = YAML.load_file('.github/workflows/athena-validation-health.yml')
def require_contract(value, message)
  raise "Affected validation workflow contract: #{message}" unless value
end
jobs = pr.fetch('jobs')
native = jobs.fetch('affected-validation-qualification')
require_contract(native.fetch('if').include?("workflow_dispatch") && native.fetch('if').include?("affected-qualification"), 'qualification must remain explicit before activation')
guard = native.fetch('steps').find { |s| s['id'] == 'base-guard' }
require_contract(guard && guard['working-directory'] == 'pinned-base' && guard.fetch('run').include?('harness-validation-ci.ts guard --candidate-root'), 'independent pinned-base candidate guard missing')
require_contract(!guard.fetch('run').include?('echo "base_guard_ready=true"') && guard.dig('env','VALIDATION_GUARD_BASE_SHA') == '\${{ steps.base.outputs.sha }}', 'guard must publish authenticated readiness, never unconditional success')
base_checkout = native.fetch('steps').find { |s| s.dig('with', 'path') == 'pinned-base' }
require_contract(base_checkout && base_checkout.dig('with','ref') == '\${{ steps.base.outputs.sha }}', 'guard checkout must pin authenticated base')
execution = native.fetch('steps').find { |s| s['id'] == 'native' }
require_contract(execution && execution.fetch('run') == 'bun "$GITHUB_WORKSPACE/pinned-base/scripts/harness-validation-ci.ts" qualify'  && execution.dig('env','VALIDATION_GUARD_BASE_SHA') == '\${{ steps.base.outputs.sha }}', 'native qualification or base binding missing')
require_contract(execution['if'] == "steps.base-guard.outputs.base_guard_ready == 'true'", 'legacy selection must not execute native validation')
final_job = jobs.fetch('affected-validation-final')
require_contract(final_job.fetch('needs').include?('affected-validation-qualification'), 'independent verifier must depend on native execution')
final_steps = final_job.fetch('steps')
require_contract(final_steps.any? { |s| s.fetch('run','') == 'test "$EXECUTION_RESULT" = "success"' && s.dig('env','EXECUTION_RESULT') == '\${{ needs.affected-validation-qualification.result }}' }, 'failed native execution must block cold verification')
require_contract(final_steps.any? { |s| s.dig('with','path') == 'pinned-base' && s.dig('with','ref') == '\${{ needs.affected-validation-qualification.outputs.base_sha }}' }, 'cold verifier must use authenticated pinned base')
final_execution = final_steps.find { |s| s['id'] == 'final' }
require_contract(final_execution && final_execution['working-directory'] == 'candidate' && final_execution['run'] == 'bun "$GITHUB_WORKSPACE/pinned-base/scripts/harness-validation-ci.ts" verify-final', 'cold verifier must run trusted controller')
require_contract(final_execution.dig('env','VALIDATION_PLAN_MODE') == '\${{ needs.affected-validation-qualification.outputs.plan_mode }}', 'cold mode must come from trusted controller output')
require_contract(final_steps.any? { |s| s.fetch('uses','').start_with?('actions/download-artifact@') && s.dig('with','name') == 'affected-validation-qualification' && s.dig('with','path') == 'candidate/artifacts/validation-ci' }, 'portable record download missing')
required = ['Athena and Storefront Webapp Validation', 'Storefront Webapp Validation Context', 'Harness Implementation Tests', 'Harness and Architecture Validation', 'Athena POS E2E against Production Backend']
required.each do |name|
  selected = jobs.values.select { |job| job['name'] == name }
  require_contract(selected.length == 1, "required context missing or duplicated: #{name}")
  job = selected.first
  require_contract(job.fetch('needs').include?('affected-validation-qualification') && job.fetch('needs').include?('affected-validation-final') && job['if'] == 'always()', "summary dependency missing: #{name}")
  summary = job.fetch('steps').find { |s| s.dig('env','NATIVE_VERIFIED') == '\${{ needs.affected-validation-final.outputs.verified }}' }
  require_contract(summary && summary.fetch('run').include?('test "$NATIVE_RESULT" = "success"') && summary.fetch('run').include?('test "$NATIVE_VERIFIED" = "true"'), "summary can pass without complete native result: #{name}")
  require_contract(summary.fetch('if').include?("workflow_dispatch") && summary.fetch('if').include?("affected-qualification") && summary.fetch('run').include?('test "$FINAL_RESULT" = "success"') && summary.fetch('run').include?('test "$BASE_GUARD_READY" = "false"'), "failed execution/final verification or unknown guard must not pass: #{name}")
end
trigger = health['on'] || health[true]
require_contract(trigger.fetch('schedule') == [{'cron' => '0 14 * * *'}] && trigger.key?('workflow_dispatch'), 'daily/manual complete health trigger missing')
require_contract(!(pr['on'] || pr[true]).key?('schedule'), 'duplicate old health schedule remains')
require_contract(health['concurrency'] == {'group'=>'athena-validation-health', 'cancel-in-progress'=>false}, 'health producers must serialize without cancelling the active run')
producer = health.fetch('jobs').fetch('full-health')
require_contract(producer.fetch('if').include?('github.event.repository.default_branch'), 'health must use default branch')
require_contract(producer.fetch('steps').any? { |s| s.fetch('run','').include?('bun run harness:validation-ci -- health') }, 'native full inventory entry missing')
artifact = producer.fetch('steps').find { |s| s.fetch('uses','').start_with?('actions/upload-artifact@') }
require_contract(artifact && artifact['if'] == 'always()' && artifact.dig('with','name') == 'athena-validation-health' && artifact.dig('with','path') == 'artifacts/validation-ci/health.json' && artifact.dig('with','retention-days') == 90, 'complete health artifact contract missing')
puts '[workflow:check] affected validation guard, summaries and health contract passed'
`;

export async function collectWorkflowFiles(rootDir: string) {
  const workflowDir = path.join(rootDir, WORKFLOW_DIRECTORY);
  const entries = await readdir(workflowDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && WORKFLOW_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(WORKFLOW_DIRECTORY, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export async function runWorkflowCheck(
  rootDir: string,
  options: WorkflowCheckOptions = {},
) {
  const workflowFiles = await collectWorkflowFiles(rootDir);
  const spawn = options.spawn ?? Bun.spawn;
  const logger = options.logger ?? console;

  if (workflowFiles.length === 0) {
    throw new Error(
      `No GitHub workflow YAML files found in ${WORKFLOW_DIRECTORY}.`,
    );
  }

  for (const workflowFile of workflowFiles) {
    const proc = spawn(
      [
        "ruby",
        "-ryaml",
        "-e",
        'YAML.load_file(ARGV.fetch(0)); puts "[workflow:check] parsed #{ARGV.fetch(0)}"',
        workflowFile,
      ],
      {
        cwd: rootDir,
        stdout: "inherit",
        stderr: "inherit",
      },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(
        `GitHub workflow YAML check failed for ${workflowFile} (exit ${exitCode}).`,
      );
    }
  }

  const contract = spawn(["ruby", "-ryaml", "-e", AFFECTED_WORKFLOW_CONTRACT], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await contract.exited) !== 0)
    throw new Error("Affected validation workflow contract failed.");

  logger.log(
    `GitHub workflow YAML check passed for ${workflowFiles.length} workflow file(s).`,
  );
}

if (import.meta.main) {
  try {
    await runWorkflowCheck(path.resolve(import.meta.dirname, ".."));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
