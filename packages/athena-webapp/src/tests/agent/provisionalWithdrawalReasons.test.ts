/**
 * The host's withdrawal vocabulary is pinned to the server's closed reason set.
 *
 * The agent host may not import a Convex server module, so the presentation
 * adapter carries its own copy of the reasons the preview ladder mints. This
 * test lives outside the host directory precisely so it can hold both lists at
 * once: if the server adds, renames, or drops a reason, the adapter's copy — and
 * the operator copy keyed on it — fails here rather than silently falling
 * through to the default arm in front of an operator.
 */
import { describe, expect, it } from "vitest";

import {
  ATHENA_AGENT_PROVISIONAL_WITHDRAWAL_REASONS,
  describeProvisionalWithdrawal,
} from "@/components/agent/AthenaAgentPresentationAdapter";
import { AGENT_PROVISIONAL_WITHDRAWAL_REASONS } from "~/convex/agentHarness/turns";

describe("provisional withdrawal reasons", () => {
  it("mirrors the server's closed set exactly", () => {
    expect([...ATHENA_AGENT_PROVISIONAL_WITHDRAWAL_REASONS].sort()).toEqual(
      [...AGENT_PROVISIONAL_WITHDRAWAL_REASONS].sort(),
    );
  });

  it("gives every server-minted reason its own operator line", () => {
    const details = AGENT_PROVISIONAL_WITHDRAWAL_REASONS.map(
      (reason) => describeProvisionalWithdrawal(reason).detail,
    );

    expect(details.filter((detail) => detail === undefined)).toEqual([]);
    expect(new Set(details).size).toBe(details.length);
  });
});
