import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import ApprovalRequestPending, {
  approvalRequestPendingPreviewProps,
  buildApprovalRequestPendingSubject,
  type ApprovalRequestPendingProps,
} from "./ApprovalRequestPending";

const baseProps: ApprovalRequestPendingProps = {
  createdAt: "8:42 PM",
  data: {
    amount: "GH₵-42.18",
    transactionNumber: "TXN-1048",
  },
  identifier: "TXN-1048",
  queueUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/operations/approvals",
  reason: "Cash refund exceeded the register's approval threshold.",
  requestType: "pos_transaction_void",
  requesterName: "Ama Mensah",
  storeName: "Wigclub East Legon",
};

const knownTypeLabels: Record<string, string> = {
  inventory_adjustment_review: "Inventory adjustment review",
  online_order_return_review: "Online order return review",
  payment_method_correction: "Payment method correction",
  pos_item_adjustment: "Item adjustment",
  pos_item_adjustment_review: "Item adjustment review",
  pos_transaction_void: "Transaction void",
  service_deposit_review: "Service deposit review",
};

describe("ApprovalRequestPending", () => {
  it("renders the base approvals email structure", async () => {
    const html = await render(<ApprovalRequestPending {...baseProps} />);

    expect(html).toContain("Athena approvals");
    expect(html).toContain("max-width:640px;background-color:#ffffff");
    expect(html).toContain("Wigclub East Legon");
    expect(html).toContain("Transaction void");
    expect(html).toContain("Ama Mensah");
    expect(html).toContain("8:42 PM");
    expect(html).toContain(
      "Cash refund exceeded the register&#x27;s approval threshold.",
    );
    expect(html).toContain("Open approvals queue");
    expect(html).toContain(baseProps.queueUrl);
    expect(html).toContain(
      "This request may already be resolved by the time you read this",
    );
    expect(html).toContain("GH₵-42.18");
    expect(html).toContain("TXN-1048");
  });

  it.each(Object.entries(knownTypeLabels))(
    "renders the %s descriptor label",
    async (requestType, label) => {
      const html = await render(
        <ApprovalRequestPending
          {...baseProps}
          requestType={requestType}
          data={{}}
        />,
      );

      expect(html).toContain(label);
    },
  );

  it("falls back to the generic descriptor for register_sync_review", async () => {
    const html = await render(
      <ApprovalRequestPending
        {...baseProps}
        requestType="register_sync_review"
        data={{}}
      />,
    );

    expect(html).toContain("Approval request");
    expect(html).toContain("Ama Mensah");
    expect(html).toContain("Open approvals queue");
  });

  it("falls back to the generic descriptor for an unrecognized request type without throwing", async () => {
    await expect(
      render(
        <ApprovalRequestPending
          {...baseProps}
          requestType="some_future_request_type"
          data={{}}
        />,
      ),
    ).resolves.toContain("Approval request");
  });

  it("renders a non-GHS currency amount string verbatim", async () => {
    const html = await render(
      <ApprovalRequestPending
        {...baseProps}
        requestType="payment_method_correction"
        data={{
          amount: "$128.50",
          paymentMethod: "Card",
          previousPaymentMethod: "Cash",
          transactionNumber: "TXN-2091",
        }}
      />,
    );

    expect(html).toContain("$128.50");
    expect(html).toContain("Cash");
    expect(html).toContain("Card");
    expect(html).not.toContain("12850");
  });

  it("omits the details section when no descriptor fields have values", async () => {
    const html = await render(
      <ApprovalRequestPending
        {...baseProps}
        requestType="service_deposit_review"
        data={{}}
      />,
    );

    expect(html).not.toContain("Request details");
  });

  it("keeps preview props renderable and internally consistent", async () => {
    const html = await render(
      <ApprovalRequestPending {...approvalRequestPendingPreviewProps} />,
    );

    expect(html).toContain(approvalRequestPendingPreviewProps.storeName);
    expect(html).toContain(approvalRequestPendingPreviewProps.requesterName);
  });

  describe("buildApprovalRequestPendingSubject", () => {
    it("builds a subject in the form '{storeName} approval needed - {label} - {identifier}'", () => {
      const subject = buildApprovalRequestPendingSubject({
        identifier: "TXN-1048",
        requestType: "pos_transaction_void",
        storeName: "Wigclub East Legon",
      });

      expect(subject).toBe(
        "Wigclub East Legon approval needed - Transaction void - TXN-1048",
      );
    });

    it("uses the generic label for unknown request types in the subject", () => {
      const subject = buildApprovalRequestPendingSubject({
        identifier: "2026-07-30",
        requestType: "register_sync_review",
        storeName: "Wigclub",
      });

      expect(subject).toBe(
        "Wigclub approval needed - Approval request - 2026-07-30",
      );
    });
  });

  describe("requester note", () => {
    it("renders the note above the policy reason", async () => {
      const html = await render(
        <ApprovalRequestPending
          {...baseProps}
          requesterNote="Customer paid with card, I rang it as cash."
        />,
      );

      expect(html).toContain("Requester note");
      expect(html).toContain(
        "Customer paid with card, I rang it as cash.",
      );
      // The note is the context unique to this request; the reason is the
      // same policy sentence on every request of the type.
      expect(html.indexOf("Requester note")).toBeLessThan(
        html.indexOf("Reason"),
      );
    });

    it("omits the section entirely when the requester wrote no note", async () => {
      const html = await render(<ApprovalRequestPending {...baseProps} />);

      expect(html).not.toContain("Requester note");
      expect(html).toContain("Reason");
    });
  });
});
