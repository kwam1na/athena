import { afterEach, describe, expect, it, vi } from "vitest";

import { ADMIN_EMAILS } from "../constants/email";
import {
  formatRegisterCloseoutVarianceAlertOperatingDate,
  formatRegisterCloseoutVarianceAlertReason,
  sendRegisterCloseoutVarianceAlertToAdminsWithCtx,
} from "./registerCloseoutVarianceEmail";

describe("register closeout variance email", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends register variance alerts to every configured admin email", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      approvalRequestId: "approval-variance-1",
      countedCash: "GH₵1,201.82",
      expectedCash: "GH₵1,244.00",
      operatingDate: "Friday, July 3",
      reason: "Variance exceeded the closeout approval threshold.",
      registerLabel: "Front counter / Register 2",
      reviewUrl:
        "https://athena.wigclub.store/wigclub/store/wigclub/cash-controls/registers/register-session-1",
      storeId: "store-1",
      storeName: "Wigclub",
      submittedAt: "8:42 PM",
      submittedBy: "Ama Mensah",
      variance: "GH₵-42.18",
      varianceDirection: "short" as const,
    };
    const runQuery = vi.fn(async () => payload);

    const result = await sendRegisterCloseoutVarianceAlertToAdminsWithCtx(
      { runQuery } as never,
      {
        approvalRequestId: "approval-variance-1" as never,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(ADMIN_EMAILS.length);
    expect(
      fetchMock.mock.calls.map((call) => {
        const body = JSON.parse(String((call[1] as RequestInit).body));
        return body.to[0];
      }),
    ).toEqual(ADMIN_EMAILS);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(body.subject).toBe(
      "Wigclub register variance - Front counter / Register 2 - Friday, July 3",
    );
    expect(body.html).toContain("Submitted with cash variance");
    expect(body.html).toContain("Friday, July 3");
    expect(body.html).toContain("Review register closeout");
    expect(result).toEqual(
      ADMIN_EMAILS.map((recipient) => ({
        approvalRequestId: "approval-variance-1",
        recipientEmail: recipient.email,
        status: 202,
        storeName: "Wigclub",
      })),
    );
  });

  it("formats stored variance amounts in review reasons with the store currency", () => {
    expect(
      formatRegisterCloseoutVarianceAlertReason(
        "GHS",
        "Variance of 2000 exceeded the closeout approval threshold.",
      ),
    ).toBe("Variance of GH₵20 exceeded the closeout approval threshold");
  });

  it("formats register closeout operating dates for the alert header", () => {
    expect(
      formatRegisterCloseoutVarianceAlertOperatingDate({
        closeoutScheduleContext: {
          kind: "resolved",
          timezone: "America/New_York",
          operatingDate: "2026-07-09",
          phase: "after_last_window",
          isOpen: false,
          scheduleVersionId: "schedule-1",
          currentWindow: null,
          nextWindow: null,
        },
        closeoutOperatingDate: "2026-07-08",
        openedOperatingDate: "2026-07-07",
      }),
    ).toBe("Wednesday, July 8");

    expect(
      formatRegisterCloseoutVarianceAlertOperatingDate({
        closeoutScheduleContext: {
          kind: "resolved",
          timezone: "America/New_York",
          operatingDate: "2026-07-08",
          phase: "after_last_window",
          isOpen: false,
          scheduleVersionId: "schedule-1",
          currentWindow: null,
          nextWindow: null,
        },
      }),
    ).toBe("Wednesday, July 8");
  });
});
