import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import {
  ReportSegmentedTabsList,
  ReportSegmentedTabsTrigger,
} from "./ReportSegmentedTabs";

describe("ReportSegmentedTabs", () => {
  it("owns the report segmented-control styling and preserves consumer overrides", () => {
    const triggerRef = createRef<HTMLButtonElement>();

    render(
      <Tabs defaultValue="first">
        <ReportSegmentedTabsList aria-label="Test views">
          <ReportSegmentedTabsTrigger value="first">
            First
          </ReportSegmentedTabsTrigger>
          <ReportSegmentedTabsTrigger
            className="h-11 sm:h-8"
            ref={triggerRef}
            value="second"
          >
            Second
          </ReportSegmentedTabsTrigger>
        </ReportSegmentedTabsList>
      </Tabs>,
    );

    expect(screen.getByRole("tablist", { name: "Test views" })).toHaveClass(
      "bg-surface-raised",
      "shadow-surface",
    );
    expect(screen.getByRole("tab", { name: "First" })).toHaveClass(
      "min-h-8",
      "data-[state=active]:bg-primary-soft",
    );
    expect(screen.getByRole("tab", { name: "Second" })).toHaveClass(
      "h-11",
      "sm:h-8",
    );
    expect(triggerRef.current).toBe(screen.getByRole("tab", { name: "Second" }));
  });
});
