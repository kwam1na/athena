import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceCatalogViewContent } from "./ServiceCatalogView";

const baseProps = {
  hasFullAdminAccess: true,
  isLoadingPermissions: false,
  isSaving: false,
  items: [
    {
      _id: "catalog-1",
      depositType: "flat" as const,
      depositValue: 100,
      durationMinutes: 90,
      name: "Closure Repair",
      pricingModel: "fixed" as const,
      requiresManagerApproval: false,
      serviceMode: "repair" as const,
      status: "active" as const,
    },
  ],
  onArchive: vi.fn().mockResolvedValue(undefined),
  onCreate: vi.fn().mockResolvedValue(undefined),
  onUpdate: vi.fn().mockResolvedValue(undefined),
};

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: RegExp
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
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(<ServiceCatalogViewContent {...baseProps} onCreate={onCreate} />);

    await user.click(screen.getByRole("button", { name: /create service/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Service name is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Duration must be greater than zero."),
    ).toBeInTheDocument();
  });

  it("creates and archives catalog items", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onArchive = vi.fn().mockResolvedValue(undefined);

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
    await user.type(screen.getByLabelText(/deposit value/i), "45");
    await user.clear(screen.getByLabelText(/base price/i));
    await user.type(screen.getByLabelText(/base price/i), "300");

    await user.click(screen.getByRole("button", { name: /create service/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      basePrice: 300,
      depositType: "flat",
      depositValue: 45,
      durationMinutes: 75,
      name: "Wash and Restyle",
      pricingModel: "fixed",
      requiresManagerApproval: false,
      serviceMode: "same_day",
    });

    await user.click(screen.getByRole("button", { name: /archive closure repair/i }));

    expect(onArchive).toHaveBeenCalledWith("catalog-1");
  });

  it("loads existing items into the form for editing", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(<ServiceCatalogViewContent {...baseProps} onUpdate={onUpdate} />);

    await user.click(screen.getByRole("button", { name: /edit closure repair/i }));

    expect(screen.getByLabelText(/service name/i)).toHaveValue("Closure Repair");

    await user.clear(screen.getByLabelText(/service name/i));
    await user.type(
      screen.getByLabelText(/service name/i),
      "Custom Closure Repair",
    );
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][0]).toMatchObject({
      name: "Custom Closure Repair",
      serviceCatalogId: "catalog-1",
    });
  });
});
