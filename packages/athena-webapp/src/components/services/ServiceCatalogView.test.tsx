import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  userError,
} from "~/shared/commandResult";
import { ServiceCatalogViewContent } from "./ServiceCatalogView";

type MockLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children?: ReactNode;
  search?: unknown;
  to?: string;
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search, to, ...props }: MockLinkProps) => {
    void search;

    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({}),
  useSearch: () => ({}),
  useNavigate: () => () => null,
}));

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => () => null,
}));

const baseProps = {
  currency: "GHS",
  hasFullAdminAccess: true,
  isLoadingPermissions: false,
  isSaving: false,
  items: [
    {
      _id: "catalog-1",
      depositType: "flat" as const,
      basePrice: 30050,
      depositValue: 10000,
      durationMinutes: 90,
      name: "Closure Repair",
      pricingModel: "fixed" as const,
      requiresManagerApproval: false,
      serviceMode: "repair" as const,
      status: "active" as const,
    },
  ],
  onArchive: vi.fn().mockResolvedValue({ kind: "ok", data: null }),
  onCreate: vi.fn().mockResolvedValue({ kind: "ok", data: null }),
  onUpdate: vi.fn().mockResolvedValue({ kind: "ok", data: null }),
};

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: RegExp,
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("ServiceCatalogViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
  });

  it("validates required catalog fields before creating", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ kind: "ok", data: null });

    render(<ServiceCatalogViewContent {...baseProps} onCreate={onCreate} />);

    await user.click(screen.getByRole("button", { name: /create service/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Service name is required")).toBeInTheDocument();
    expect(
      screen.getByText("Duration must be greater than zero"),
    ).toBeInTheDocument();
  });

  it("prevents duplicate service names case-insensitively before saving", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ kind: "ok", data: null });

    render(<ServiceCatalogViewContent {...baseProps} onCreate={onCreate} />);

    await user.clear(screen.getByLabelText(/service name/i));
    await user.type(screen.getByLabelText(/service name/i), "closure repair");
    await user.clear(screen.getByLabelText(/duration/i));
    await user.type(screen.getByLabelText(/duration/i), "90");
    await user.clear(screen.getByLabelText(/base price/i));
    await user.type(screen.getByLabelText(/base price/i), "300");

    await user.click(screen.getByRole("button", { name: /create service/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(
      screen.getByText("A service catalog item with this name already exists."),
    ).toBeInTheDocument();
  });

  it("creates and archives catalog items", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ kind: "ok", data: null });
    const onArchive = vi.fn().mockResolvedValue({ kind: "ok", data: null });

    render(
      <ServiceCatalogViewContent
        {...baseProps}
        onArchive={onArchive}
        onCreate={onCreate}
      />,
    );

    await user.clear(screen.getByLabelText(/service name/i));
    await user.type(screen.getByLabelText(/service name/i), "Wash and Restyle");
    await user.clear(screen.getByLabelText(/duration/i));
    await user.type(screen.getByLabelText(/duration/i), "75");
    await chooseSelectOption(user, /service mode/i, /^same-day$/i);
    await chooseSelectOption(user, /deposit rule/i, /flat deposit/i);
    await user.clear(screen.getByLabelText(/deposit value/i));
    await user.type(screen.getByLabelText(/deposit value/i), "45.25");
    await user.clear(screen.getByLabelText(/base price/i));
    await user.type(screen.getByLabelText(/base price/i), "300.50");

    await user.click(screen.getByRole("button", { name: /create service/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      basePrice: 30050,
      depositType: "flat",
      depositValue: 4525,
      durationMinutes: 75,
      name: "Wash and Restyle",
      pricingModel: "fixed",
      requiresManagerApproval: false,
      serviceMode: "same_day",
    });

    await user.click(
      screen.getByRole("button", { name: /archive closure repair/i }),
    );

    expect(onArchive).toHaveBeenCalledWith("catalog-1");
  });

  it("renders catalog summary metadata as display labels", () => {
    render(
      <ServiceCatalogViewContent
        {...baseProps}
        items={[
          {
            _id: "catalog-2",
            depositType: "none",
            durationMinutes: 30,
            name: "chiefin",
            pricingModel: "fixed",
            requiresManagerApproval: false,
            serviceMode: "same_day",
            status: "active",
          },
        ]}
      />,
    );

    expect(screen.getByText("Chiefin")).toBeInTheDocument();
    expect(
      screen.getByText("30 min · Same-day · No deposit"),
    ).toBeInTheDocument();
  });

  it("caps the current services preview at three items", () => {
    render(
      <ServiceCatalogViewContent
        {...baseProps}
        items={[
          {
            _id: "catalog-1",
            depositType: "none",
            durationMinutes: 30,
            name: "first service",
            pricingModel: "fixed",
            requiresManagerApproval: false,
            serviceMode: "same_day",
            status: "active",
          },
          {
            _id: "catalog-2",
            depositType: "none",
            durationMinutes: 45,
            name: "second service",
            pricingModel: "fixed",
            requiresManagerApproval: false,
            serviceMode: "same_day",
            status: "active",
          },
          {
            _id: "catalog-3",
            depositType: "none",
            durationMinutes: 60,
            name: "third service",
            pricingModel: "fixed",
            requiresManagerApproval: false,
            serviceMode: "same_day",
            status: "active",
          },
          {
            _id: "catalog-4",
            depositType: "none",
            durationMinutes: 75,
            name: "fourth service",
            pricingModel: "fixed",
            requiresManagerApproval: false,
            serviceMode: "same_day",
            status: "active",
          },
        ]}
      />,
    );

    expect(screen.getByText("First service")).toBeInTheDocument();
    expect(screen.getByText("Second service")).toBeInTheDocument();
    expect(screen.getByText("Third service")).toBeInTheDocument();
    expect(screen.queryByText("Fourth service")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 4 services.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open all services workspace/i }),
    ).toHaveAttribute("href", "#services-workspace");
  });

  it("loads existing items into the form for editing", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue({ kind: "ok", data: null });

    render(<ServiceCatalogViewContent {...baseProps} onUpdate={onUpdate} />);

    await user.click(
      screen.getByRole("button", { name: /edit closure repair/i }),
    );

    expect(screen.getByLabelText(/service name/i)).toHaveValue(
      "Closure Repair",
    );
    expect(screen.getByLabelText(/base price/i)).toHaveValue("300.5");
    expect(screen.getByLabelText(/deposit value/i)).toHaveValue("100");

    await user.clear(screen.getByLabelText(/service name/i));
    await user.type(
      screen.getByLabelText(/service name/i),
      "Custom Closure Repair",
    );
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][0]).toMatchObject({
      basePrice: 30050,
      depositValue: 10000,
      name: "Custom Closure Repair",
      serviceCatalogId: "catalog-1",
    });
  });

  it("keeps percentage catalog deposits as raw percentages", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ kind: "ok", data: null });

    render(<ServiceCatalogViewContent {...baseProps} onCreate={onCreate} />);

    await user.clear(screen.getByLabelText(/service name/i));
    await user.type(screen.getByLabelText(/service name/i), "Consultation");
    await user.clear(screen.getByLabelText(/duration/i));
    await user.type(screen.getByLabelText(/duration/i), "30");
    await chooseSelectOption(user, /deposit rule/i, /percentage deposit/i);
    await user.clear(screen.getByLabelText(/deposit value/i));
    await user.type(screen.getByLabelText(/deposit value/i), "20");
    await user.clear(screen.getByLabelText(/base price/i));
    await user.type(screen.getByLabelText(/base price/i), "300.50");

    await user.click(screen.getByRole("button", { name: /create service/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      basePrice: 30050,
      depositType: "percentage",
      depositValue: 20,
    });
  });

  it("explains and scopes the deposit value by deposit rule", async () => {
    const user = userEvent.setup();

    render(<ServiceCatalogViewContent {...baseProps} />);

    expect(screen.getByLabelText(/deposit value/i)).toBeDisabled();
    expect(
      screen.getByText("Choose a deposit rule before entering a value."),
    ).toBeInTheDocument();

    await chooseSelectOption(user, /deposit rule/i, /flat deposit/i);
    expect(screen.getByLabelText(/deposit value/i)).toBeEnabled();
    expect(screen.getByText(/fixed amount collected/i)).toBeInTheDocument();

    await chooseSelectOption(user, /deposit rule/i, /percentage deposit/i);
    expect(screen.getByText(/percent of the base price/i)).toBeInTheDocument();
  });

  it("renders safe user_error copy inline and clears stale errors before retry", async () => {
    const user = userEvent.setup();
    const onCreate = vi
      .fn()
      .mockResolvedValueOnce(
        userError({
          code: "conflict",
          message: "A service catalog item with this name already exists.",
        }),
      )
      .mockResolvedValueOnce({ kind: "ok", data: null });

    render(<ServiceCatalogViewContent {...baseProps} onCreate={onCreate} />);

    await user.clear(screen.getByLabelText(/service name/i));
    await user.type(screen.getByLabelText(/service name/i), "Backend Duplicate");
    await user.clear(screen.getByLabelText(/duration/i));
    await user.type(screen.getByLabelText(/duration/i), "90");

    await user.click(screen.getByRole("button", { name: /create service/i }));

    expect(
      await screen.findByText(
        "A service catalog item with this name already exists.",
      ),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/service name/i));
    await user.type(screen.getByLabelText(/service name/i), "Wash and Restyle");
    await user.click(screen.getByRole("button", { name: /create service/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByText(
          "A service catalog item with this name already exists.",
        ),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders generic fallback copy inline for unexpected failures", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      },
    });

    render(<ServiceCatalogViewContent {...baseProps} onCreate={onCreate} />);

    await user.clear(screen.getByLabelText(/service name/i));
    await user.type(screen.getByLabelText(/service name/i), "Wash and Restyle");
    await user.clear(screen.getByLabelText(/duration/i));
    await user.type(screen.getByLabelText(/duration/i), "75");
    await user.click(screen.getByRole("button", { name: /create service/i }));

    expect(
      await screen.findByText(GENERIC_UNEXPECTED_ERROR_MESSAGE),
    ).toBeInTheDocument();
  });
});
