import { describe, expect, it } from "vitest";

import {
  assertArtifactTransition,
  assertRunTransition,
  canTransitionArtifact,
  canTransitionRun,
} from "./lifecycle";

describe("intelligence lifecycle transitions", () => {
  it("allows the expected happy path for generated artifacts", () => {
    expect(canTransitionRun("queued", "context_captured")).toBe(true);
    expect(canTransitionRun("context_captured", "running")).toBe(true);
    expect(canTransitionRun("running", "completed")).toBe(true);
    expect(canTransitionArtifact("ready", "stale")).toBe(true);
    expect(canTransitionArtifact("stale", "superseded")).toBe(true);
  });

  it("rejects transitions out of terminal run states", () => {
    expect(() => assertRunTransition("completed", "running")).toThrow(
      "Invalid intelligence run transition: completed -> running",
    );
    expect(() => assertRunTransition("failed", "running")).toThrow(
      "Invalid intelligence run transition: failed -> running",
    );
  });

  it("rejects transitions out of terminal artifact states", () => {
    expect(() => assertArtifactTransition("dismissed", "ready")).toThrow(
      "Invalid intelligence artifact transition: dismissed -> ready",
    );
    expect(() => assertArtifactTransition("superseded", "stale")).toThrow(
      "Invalid intelligence artifact transition: superseded -> stale",
    );
  });
});
