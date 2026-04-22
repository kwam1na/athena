import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createWorkflowTraceId } from "~/shared/workflowTrace";

import {
  WorkflowTraceLink,
  getWorkflowTraceLinkTarget,
} from "./WorkflowTraceLink";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
  }: {
    children: React.ReactNode;
    params: (prev: {
      orgUrlSlug?: string;
      storeUrlSlug?: string;
    }) => {
      orgUrlSlug: string;
      storeUrlSlug: string;
      traceId: string;
    };
  }) => {
    const resolvedParams = params({
      orgUrlSlug: "acme",
      storeUrlSlug: "main",
    });

    return (
      <a
        href={`/_authed/${resolvedParams.orgUrlSlug}/store/${resolvedParams.storeUrlSlug}/traces/${resolvedParams.traceId}`}
      >
        {children}
      </a>
    );
  },
}));

describe("createWorkflowTraceId", () => {
  it("builds the POS workflow trace id from a transaction number", () => {
    expect(
      createWorkflowTraceId({
        workflowType: "pos_sale",
        primaryLookupValue: "POS-123456",
      })
    ).toBe("pos_sale:pos-123456");
  });
});

describe("getWorkflowTraceLinkTarget", () => {
  it("builds the shared trace route target from a POS transaction number", () => {
    const target = getWorkflowTraceLinkTarget("POS-123456");

    expect(target.traceId).toBe("pos_sale:pos-123456");
    expect(target.to).toBe("/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId");
  });
});

describe("WorkflowTraceLink", () => {
  it("renders a shared trace route link for a POS transaction", () => {
    render(<WorkflowTraceLink transactionNumber="POS-123456" />);

    expect(
      screen.getByRole("link", { name: /view trace/i })
    ).toHaveAttribute(
      "href",
      "/_authed/acme/store/main/traces/pos_sale:pos-123456"
    );
  });
});
