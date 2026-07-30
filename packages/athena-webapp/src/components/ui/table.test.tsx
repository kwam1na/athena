import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/common/AnimatedHeight", () => ({
  AnimatedHeight: ({
    children,
    enabled,
  }: {
    children: React.ReactNode;
    enabled?: boolean;
  }) => (
    <div data-enabled={String(enabled)} data-testid="animated-height">
      {children}
    </div>
  ),
}));

import { Table, TableBody, TableCell, TableRow } from "./table";

describe("Table", () => {
  it("opts into the shared height transition through its base API", () => {
    render(
      <Table resize="smooth">
        <TableBody>
          <TableRow>
            <TableCell>One row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByTestId("animated-height")).toHaveAttribute(
      "data-enabled",
      "true",
    );
  });

  it("keeps the default table resize immediate", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>One row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.queryByTestId("animated-height")).not.toBeInTheDocument();
  });
});
