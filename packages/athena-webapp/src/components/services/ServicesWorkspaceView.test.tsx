import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesWorkspaceViewContent } from "./ServicesWorkspaceView";

type MockLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children?: ReactNode;
  to?: string;
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: MockLinkProps) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useParams: () => ({}),
  useSearch: () => ({}),
  useNavigate: () => () => null,
}));

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => () => null,
}));

const baseItems = [
  {
    _id: "catalog-1",
    basePrice: 30050,
    depositType: "flat" as const,
    depositValue: 10000,
    description: "Repair closures and reinforce the hairline.",
    durationMinutes: 90,
    name: "closure repair",
    pricingModel: "fixed" as const,
    requiresManagerApproval: true,
    serviceMode: "repair" as const,
    status: "active" as const,
  },
  {
    _id: "catalog-2",
    basePrice: 45000,
    depositType: "percentage" as const,
    depositValue: 20,
    durationMinutes: 60,
    name: "revamp",
    pricingModel: "starting_at" as const,
    requiresManagerApproval: false,
    serviceMode: "revamp" as const,
    status: "active" as const,
  },
  {
    _id: "catalog-3",
    depositType: "none" as const,
    durationMinutes: 30,
    name: "consultation",
    pricingModel: "quote_after_consultation" as const,
    requiresManagerApproval: false,
    serviceMode: "consultation" as const,
    status: "archived" as const,
  },
];

describe("ServicesWorkspaceViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  it("shows service metrics, cards, and selected service details", () => {
    render(
      <ServicesWorkspaceViewContent
        catalogManagementHref="/wigclub/store/wigclub/services/catalog-management"
        currency="GHS"
        items={baseItems}
      />,
    );

    expect(screen.getByText("Total services")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Manager approval")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("Closure repair")).toHaveLength(2);
    expect(
      screen.getByText("90 min · Repair · Fixed price · GH₵300.50"),
    ).toBeInTheDocument();
    expect(screen.getByText("Repair closures and reinforce the hairline."))
      .toBeInTheDocument();
    expect(screen.getByText("Manager approval required")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /manage catalog/i })).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/services/catalog-management",
    );
  });

  it("filters services and updates the selected detail panel", async () => {
    const user = userEvent.setup();

    render(
      <ServicesWorkspaceViewContent
        currency="GHS"
        items={baseItems}
      />,
    );

    await user.type(screen.getByLabelText(/search services/i), "revamp");

    expect(screen.getAllByText("Revamp").length).toBeGreaterThan(1);
    expect(screen.queryByText("Closure repair")).not.toBeInTheDocument();
    expect(screen.getAllByText("20% of base price")).toHaveLength(2);
    expect(screen.getByText("Starting at · GH₵450.00")).toBeInTheDocument();
  });

  it("paginates the service directory at eight services per page", async () => {
    const user = userEvent.setup();
    const pagedItems = Array.from({ length: 10 }, (_, index) => ({
      _id: `catalog-${index + 1}`,
      basePrice: 10000 + index * 1000,
      depositType: "none" as const,
      durationMinutes: 30 + index,
      name: `service ${String(index + 1).padStart(2, "0")}`,
      pricingModel: "fixed" as const,
      requiresManagerApproval: false,
      serviceMode: "same_day" as const,
      status: "active" as const,
    }));

    render(<ServicesWorkspaceViewContent currency="GHS" items={pagedItems} />);

    const directory = screen.getByRole("region", {
      name: /service directory/i,
    });

    expect(within(directory).getByText("Showing 1-8 of 10"))
      .toBeInTheDocument();
    expect(within(directory).getByText("Page 1 of 2")).toBeInTheDocument();
    expect(within(directory).getByText("Service 08")).toBeInTheDocument();
    expect(within(directory).queryByText("Service 09")).not.toBeInTheDocument();

    await user.click(
      within(directory).getByRole("button", { name: /go to next page/i }),
    );

    expect(within(directory).getByText("Showing 9-10 of 10"))
      .toBeInTheDocument();
    expect(within(directory).getByText("Page 2 of 2")).toBeInTheDocument();
    expect(within(directory).queryByText("Service 08")).not.toBeInTheDocument();
    expect(within(directory).getByText("Service 09")).toBeInTheDocument();
  });
});
