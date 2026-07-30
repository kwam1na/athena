import type { CSSProperties } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";

/**
 * The seven approval request types this template has a dedicated
 * descriptor for. Any other value (including "register_sync_review",
 * which is synthesized rather than stored as an approvalRequest row)
 * falls back to GENERIC_APPROVAL_REQUEST_DESCRIPTOR below.
 */
export type KnownApprovalRequestType =
  | "pos_transaction_void"
  | "pos_item_adjustment"
  | "pos_item_adjustment_review"
  | "payment_method_correction"
  | "online_order_return_review"
  | "service_deposit_review"
  | "inventory_adjustment_review";

/**
 * Pre-formatted display fields for an approval request. Values are
 * already formatted for display (money already formatted with the
 * store's currency server-side) - this template does no currency math
 * and never inspects raw numeric amounts.
 */
export interface ApprovalRequestPendingData {
  transactionNumber?: string;
  amount?: string;
  previousPaymentMethod?: string;
  paymentMethod?: string;
  itemSummary?: string;
  orderNumber?: string;
  serviceName?: string;
  depositAmount?: string;
  adjustmentSummary?: string;
  netQuantityDelta?: string;
  registerLabel?: string;
  conflictCount?: string;
  [key: string]: string | undefined;
}

export interface ApprovalRequestPendingProps {
  storeName: string;
  requestType: string;
  /** Transaction number, order number, batch id, or operating date - whatever best identifies this request. */
  identifier: string;
  requesterName: string;
  createdAt: string;
  reason?: string;
  queueUrl: string;
  data?: ApprovalRequestPendingData;
}

interface ApprovalRequestFieldDescriptor {
  key: keyof ApprovalRequestPendingData;
  label: string;
}

interface ApprovalRequestDescriptor {
  label: string;
  subjectFragment: string;
  fields: ApprovalRequestFieldDescriptor[];
}

const APPROVAL_REQUEST_DESCRIPTORS: Record<
  KnownApprovalRequestType,
  ApprovalRequestDescriptor
> = {
  pos_transaction_void: {
    label: "Transaction void",
    subjectFragment: "Transaction void",
    fields: [
      { key: "transactionNumber", label: "Transaction" },
      { key: "amount", label: "Amount" },
    ],
  },
  pos_item_adjustment: {
    label: "Item adjustment",
    subjectFragment: "Item adjustment",
    fields: [
      { key: "transactionNumber", label: "Transaction" },
      { key: "itemSummary", label: "Items" },
      { key: "amount", label: "Adjustment amount" },
    ],
  },
  pos_item_adjustment_review: {
    label: "Item adjustment review",
    subjectFragment: "Item adjustment review",
    fields: [
      { key: "transactionNumber", label: "Transaction" },
      { key: "itemSummary", label: "Items" },
      { key: "amount", label: "Adjustment amount" },
    ],
  },
  payment_method_correction: {
    label: "Payment method correction",
    subjectFragment: "Payment method correction",
    fields: [
      { key: "transactionNumber", label: "Transaction" },
      { key: "previousPaymentMethod", label: "Previous method" },
      { key: "paymentMethod", label: "Corrected method" },
      { key: "amount", label: "Amount" },
    ],
  },
  online_order_return_review: {
    label: "Online order return review",
    subjectFragment: "Return review",
    fields: [
      { key: "orderNumber", label: "Order" },
      { key: "itemSummary", label: "Items" },
    ],
  },
  service_deposit_review: {
    label: "Service deposit review",
    subjectFragment: "Deposit review",
    fields: [
      { key: "serviceName", label: "Service" },
      { key: "depositAmount", label: "Deposit amount" },
    ],
  },
  inventory_adjustment_review: {
    label: "Inventory adjustment review",
    subjectFragment: "Inventory adjustment review",
    fields: [
      { key: "adjustmentSummary", label: "Adjustment" },
      { key: "netQuantityDelta", label: "Net quantity change" },
    ],
  },
};

/**
 * Required fallback for "register_sync_review" and any request type this
 * template does not yet know about. Rendering must never throw or
 * silently skip the notification, so unmapped types still get a clear,
 * generic approval email rather than being dropped.
 */
const GENERIC_APPROVAL_REQUEST_DESCRIPTOR: ApprovalRequestDescriptor = {
  label: "Approval request",
  subjectFragment: "Approval request",
  fields: [],
};

function getApprovalRequestDescriptor(
  requestType: string,
): ApprovalRequestDescriptor {
  return (
    APPROVAL_REQUEST_DESCRIPTORS[requestType as KnownApprovalRequestType] ??
    GENERIC_APPROVAL_REQUEST_DESCRIPTOR
  );
}

/**
 * Builds the notification subject: "{storeName} approval needed - {type
 * label} - {identifier}". Store identity always leads, matching the
 * header inside the email body.
 */
export function buildApprovalRequestPendingSubject({
  storeName,
  requestType,
  identifier,
}: Pick<
  ApprovalRequestPendingProps,
  "storeName" | "requestType" | "identifier"
>): string {
  const descriptor = getApprovalRequestDescriptor(requestType);
  return `${storeName} approval needed - ${descriptor.label} - ${identifier}`;
}

export const approvalRequestPendingPreviewProps = {
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
  storeName: "Wigclub",
} satisfies ApprovalRequestPendingProps;

export default function ApprovalRequestPending({
  storeName,
  requestType,
  identifier,
  requesterName,
  createdAt,
  reason,
  queueUrl,
  data = {},
}: ApprovalRequestPendingProps) {
  const descriptor = getApprovalRequestDescriptor(requestType);
  const subject = buildApprovalRequestPendingSubject({
    storeName,
    requestType,
    identifier,
  });
  const visibleFields = descriptor.fields.filter(
    (field) => Boolean(data[field.key]),
  );

  return (
    <Html>
      <Head />
      <Preview>{subject}</Preview>
      <Body style={styles.body}>
        <Container style={styles.unborderedShell}>
          <Section style={styles.header}>
            <Text style={styles.eyebrow}>Athena approvals</Text>
            <Text style={styles.title}>{storeName}</Text>
            <Text style={styles.subtitle}>
              {descriptor.label} | {identifier}
            </Text>
          </Section>

          <Section
            style={{
              ...styles.statusPanel,
              borderLeft: `3px solid ${colors.warning}`,
            }}
          >
            <Row>
              <Column style={styles.statusColumn}>
                <Text style={styles.statusLabel}>Approval needed</Text>
                <Text style={styles.statusTitle}>{descriptor.label}</Text>
                <Text style={styles.statusSummary}>
                  Requested by {requesterName} at {createdAt}.
                </Text>
              </Column>
            </Row>
          </Section>

          {visibleFields.length > 0 ? (
            <Section style={styles.section}>
              <SectionHeading title="Request details" />
              <FieldGrid fields={visibleFields} data={data} />
            </Section>
          ) : null}

          {reason ? (
            <Section style={styles.separatedSection}>
              <SectionHeading title="Reason" />
              <Text style={styles.reasonText}>{reason}</Text>
            </Section>
          ) : null}

          <Section style={styles.noteSection}>
            <Text style={styles.noteText}>
              This request may already be resolved by the time you read this
              email. Open the approvals queue for its current status before
              taking action.
            </Text>
          </Section>

          <Section style={styles.actionSection}>
            <Button href={queueUrl} style={styles.buttonPrimary}>
              <span style={styles.buttonLabel}>Open approvals queue</span>
              <span aria-hidden="true" style={styles.buttonIcon}>
                ↗
              </span>
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <Row style={styles.sectionHeading}>
      <Column>
        <Text style={styles.sectionTitleQuiet}>{title}</Text>
      </Column>
    </Row>
  );
}

function FieldGrid({
  fields,
  data,
}: {
  fields: ApprovalRequestFieldDescriptor[];
  data: ApprovalRequestPendingData;
}) {
  const rows: ApprovalRequestFieldDescriptor[][] = [];

  for (let index = 0; index < fields.length; index += 2) {
    rows.push(fields.slice(index, index + 2));
  }

  return (
    <Section style={styles.summaryGrid}>
      {rows.map((row, rowIndex) => (
        <Row key={`field-row-${rowIndex}`} style={styles.summaryGridRow}>
          {row.map((field) => (
            <Column key={field.key} style={styles.summaryGridColumn}>
              <Text style={styles.summaryLabel}>{field.label}</Text>
              <Text style={styles.summaryValue}>{data[field.key]}</Text>
            </Column>
          ))}
          {row.length < 2 ? <Column style={styles.summaryGridColumn} /> : null}
        </Row>
      ))}
    </Section>
  );
}

const fontSans =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const fontNumeric =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const colors = {
  background: "#f6f6f4",
  border: "#e2e3e6",
  danger: "#dc4438",
  foreground: "#1b1c1f",
  muted: "#6f737b",
  raised: "#ffffff",
  success: "#2d7d4f",
  surface: "#f8f8f6",
  warning: "#b66b00",
};

const styles: Record<string, CSSProperties> = {
  actionSection: {
    padding: "24px 32px 32px",
    textAlign: "right",
  },
  body: {
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fontSans,
    margin: 0,
    padding: "36px 0",
  },
  buttonPrimary: {
    backgroundColor: colors.foreground,
    border: `1px solid ${colors.foreground}`,
    borderRadius: "6px",
    color: colors.raised,
    display: "inline-block",
    fontFamily: fontSans,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "20px",
    padding: "10px 14px",
    textDecoration: "none",
  },
  buttonIcon: {
    display: "inline-block",
    fontFamily: fontSans,
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: "14px",
    marginLeft: "8px",
    verticalAlign: "1px",
  },
  buttonLabel: {
    verticalAlign: "middle",
  },
  eyebrow: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.11em",
    lineHeight: "15px",
    margin: "0 0 10px",
    textTransform: "uppercase",
  },
  header: {
    padding: "36px 32px 24px",
  },
  noteSection: {
    backgroundColor: colors.surface,
    borderTop: `1px solid ${colors.border}`,
    padding: "20px 32px",
  },
  noteText: {
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "18px",
    margin: 0,
  },
  reasonText: {
    color: colors.foreground,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "9px 0 0",
  },
  section: {
    padding: "28px 32px 24px",
  },
  sectionHeading: {
    margin: 0,
  },
  sectionTitleQuiet: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    lineHeight: "15px",
    margin: 0,
    textTransform: "uppercase",
  },
  separatedSection: {
    borderTop: `1px solid ${colors.border}`,
    padding: "24px 32px",
  },
  statusColumn: {
    verticalAlign: "top",
  },
  statusLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    lineHeight: "15px",
    margin: 0,
    textTransform: "uppercase",
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    borderTop: `1px solid ${colors.border}`,
    padding: "20px 32px 21px 29px",
  },
  statusSummary: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "6px 0 0",
  },
  statusTitle: {
    color: colors.foreground,
    fontSize: "20px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: "26px",
    margin: "5px 0 0",
  },
  subtitle: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: 0,
  },
  summaryGrid: {
    marginTop: "18px",
  },
  summaryGridColumn: {
    padding: "0 20px 0 0",
    verticalAlign: "top",
    width: "50%",
  },
  summaryGridRow: {
    marginBottom: "30px",
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.05em",
    lineHeight: "15px",
    margin: "0 0 6px",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "20px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 400,
    letterSpacing: "-0.02em",
    lineHeight: "26px",
    margin: 0,
    whiteSpace: "nowrap",
  },
  title: {
    color: colors.foreground,
    fontSize: "32px",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: "37px",
    margin: "0 0 7px",
  },
  unborderedShell: {
    backgroundColor: colors.raised,
    margin: "0 auto",
    maxWidth: "640px",
    overflow: "hidden",
  },
};
