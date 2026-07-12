import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
import { ReportsSkuEvidenceList } from "./ReportsSkuEvidenceList";

describe("ReportsSkuEvidenceList", () => {
  it("maps typed source destinations without exposing raw ids as paths", () => {
    render(
      <ReportsSkuEvidenceList
        rows={[
          {
            identityKey: "sale-1",
            evidenceKind: "fact",
            factType: "sale",
            occurrenceAt: 1,
            recognitionAt: 1,
            completeness: "complete",
            destinations: [
              { kind: "transaction", targetId: "transaction-secret" },
            ],
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Open source detail" }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
    );
    expect(screen.queryByText("transaction-secret")).not.toBeInTheDocument();
  });
});
