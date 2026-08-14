import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { approvalControlDisabled, WaiverCandidateDetails } from "./waiver.approve";

describe("WaiverCandidateDetails", () => {
  it("renders every authorization value before the passkey ceremony", () => {
    const values = [
      "kwam1na/athena",
      "123",
      "head-1",
      "origin/main",
      "base-1",
      "merge-base-1",
      "tree-1",
      "deliverable-tree/v1",
      "compound-solution",
      "Accepted for this exact candidate.",
    ];
    const html = renderToStaticMarkup(<WaiverCandidateDetails candidate={{
      repository: values[0],
      prNumber: 123,
      headSha: values[2],
      baseRef: values[3],
      baseSha: values[4],
      diffBaseSha: values[5],
      deliverableTreeSha: values[6],
      identityVersion: values[7],
      waivedFindingCodes: [values[8]],
      reason: values[9],
    }} />);

    for (const value of values) expect(html).toContain(value);
  });

  it("enables approval only after the exact candidate has loaded", () => {
    expect(approvalControlDisabled("loading", false)).toBe(true);
    expect(approvalControlDisabled("ready", false)).toBe(true);
    expect(approvalControlDisabled("error", true)).toBe(true);
    expect(approvalControlDisabled("ready", true)).toBe(false);
  });
});
