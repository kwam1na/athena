import { describe, expect, it } from "vitest";

import { POS_LOCAL_STORE_V9_LOGICAL_FIXTURE } from "./__fixtures__/posLocalStoreV9";
import { validatePosLocalStoreSnapshotShape } from "./posLocalStoreSnapshot";

describe("validatePosLocalStoreSnapshotShape", () => {
  it("accepts a complete current v9 logical fixture", () => {
    expect(
      validatePosLocalStoreSnapshotShape(POS_LOCAL_STORE_V9_LOGICAL_FIXTURE),
    ).toEqual({ valid: true });
  });

  it("rejects data sections omitted from the manifest", () => {
    expect(
      validatePosLocalStoreSnapshotShape({
        ...POS_LOCAL_STORE_V9_LOGICAL_FIXTURE,
        sections: {
          ...POS_LOCAL_STORE_V9_LOGICAL_FIXTURE.sections,
          unexpected: [],
        },
      }),
    ).toEqual({ valid: false, reason: "unlisted_section" });
  });

  it("validates counts and identities for future listed sections too", () => {
    expect(
      validatePosLocalStoreSnapshotShape({
        ...POS_LOCAL_STORE_V9_LOGICAL_FIXTURE,
        manifest: {
          ...POS_LOCAL_STORE_V9_LOGICAL_FIXTURE.manifest,
          sections: [
            ...POS_LOCAL_STORE_V9_LOGICAL_FIXTURE.manifest.sections,
            { count: 2, identities: ["future:1", "future:1"], name: "future" },
          ],
        },
        sections: {
          ...POS_LOCAL_STORE_V9_LOGICAL_FIXTURE.sections,
          future: [{}],
        },
      }),
    ).toEqual({ valid: false, reason: "count_mismatch" });
  });
});
