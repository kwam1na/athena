import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

import { WALKTHROUGH_PRIVACY_NOTICE_STATUS } from "@/lib/marketing/walkthroughPrivacy";
import { PrivacyPage } from "./privacy";

describe("walkthrough privacy route", () => {
  it("documents collection, access, retention, provider processing, and subject requests", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy and retention details" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Information collected" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "How the information is used" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Retention and redaction" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Export or deletion requests" })).toBeVisible();
    expect(screen.getByText(/transactional email provider/)).toBeVisible();
    expect(screen.getByText(/owner-approved privacy contact/)).toBeVisible();
  });

  it("keeps launch approval blocked until the owner contact is supplied", () => {
    expect(WALKTHROUGH_PRIVACY_NOTICE_STATUS).toBe("prelaunch_pending_owner_contact");
  });
});
