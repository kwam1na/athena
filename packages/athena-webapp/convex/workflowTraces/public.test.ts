import { describe, expect, it } from "vitest";

import { selectWorkflowTraceEventWindow } from "./public";

describe("workflow trace event window", () => {
  it("discloses truncation while keeping a fixed event ceiling", () => {
    const candidates = Array.from({ length: 501 }, (_, index) => index);

    expect(selectWorkflowTraceEventWindow(candidates)).toEqual({
      events: Array.from({ length: 500 }, (_, index) => index),
      eventsTruncated: true,
    });
  });

  it("keeps complete timelines marked as complete", () => {
    expect(selectWorkflowTraceEventWindow([1, 2])).toEqual({
      events: [1, 2],
      eventsTruncated: false,
    });
  });
});
