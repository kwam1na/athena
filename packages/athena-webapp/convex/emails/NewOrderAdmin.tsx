import type { CSSProperties } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { ArrowUpRight } from "lucide-react";

interface OrderItem {
  text: string;
  image: string;
  price: string;
  discountedPrice?: string;
  savings?: string;
  quantity: string;
  color: string;
  length?: string;
}

export interface NewOrderAdminProps {
  store_name: string;
  order_amount: string;
  order_status: string;
  order_date: string;
  customer_name: string;
  order_id: string;
  appUrl: string;
  order_number: string;
  items: OrderItem[];
  delivery_method: string;
  delivery_details: string;
  delivery_fee?: string;
  discount?: string;
  subtotal: string;
}

export const newOrderAdminPreviewProps = {
  store_name: "Wigclub",
  order_amount: "GH₵150",
  order_status: "pending",
  order_date: "July 17, 2026",
  customer_name: "John Doe",
  order_id: "order-001",
  appUrl:
    "http://localhost:5173/wigclub/store/wigclub/orders/order-001",
  order_number: "WC-001",
  items: [
    {
      text: "Sample Product",
      image:
        "https://images.wigclub.store/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/1d23a4ff-7f3c-4c8e-c7d2-6efc6a217079.webp",
      price: "GH₵100",
      discountedPrice: "GH₵90",
      savings: "GH₵10",
      quantity: "2",
      color: "Black",
      length: "16 inches",
    },
    {
      text: "Another Product",
      image:
        "https://images.wigclub.store/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/1d23a4ff-7f3c-4c8e-c7d2-6efc6a217079.webp",
      price: "GH₵50",
      quantity: "1",
      color: "Brown",
    },
  ],
  delivery_method: "Delivery",
  delivery_details: "123 Main Street, Accra",
  delivery_fee: "GH₵10",
  discount: "GH₵10",
  subtotal: "GH₵150",
} satisfies NewOrderAdminProps;

export function NewOrderAdmin({
  store_name,
  order_amount,
  order_status,
  order_date,
  customer_name,
  order_id: _order_id,
  appUrl,
  order_number,
  items,
  delivery_method,
  delivery_details,
  delivery_fee,
  discount,
  subtotal,
}: NewOrderAdminProps) {
  const status = formatStatus(order_status);
  const fulfillmentHeading = `${delivery_method} details`;
  const orderTitle = `Order ${order_number}`;
  const orderContext = `${customer_name} · ${order_date}`;

  return (
    <Html>
      <Head />
      <Preview>
        {store_name}: new order {order_number} from {customer_name}
      </Preview>
      <Body style={styles.body}>
        <Container style={styles.shell}>
          <Section style={styles.header}>
            <Text style={styles.storeName}>{store_name}</Text>
            <Text style={styles.title}>New order received</Text>
          </Section>

          <Section style={styles.statusPanel}>
            <Row>
              <Column style={styles.statusDetailsColumn}>
                <Text style={styles.statusTitle}>{orderTitle}</Text>
                <Text style={styles.statusSummary}>{orderContext}</Text>
                <Text style={styles.statusValue}>{status}</Text>
              </Column>
              <Column style={styles.amountColumn}>
                <Text style={styles.amount}>{order_amount}</Text>
              </Column>
            </Row>
          </Section>

          <Section style={styles.section}>
            <SectionHeading>Items</SectionHeading>
            {items.length > 0 ? (
              <Section style={styles.itemsList}>
                {items.map((item, index) => {
                  const metadata = [
                    item.color,
                    item.length,
                    `Qty ${item.quantity}`,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <Section key={`${item.text}-${index}`}>
                      <Row style={styles.itemRow}>
                        {item.image ? (
                          <Column style={styles.itemImageColumn}>
                            <Img
                              src={item.image}
                              alt={item.text}
                              style={styles.itemImage}
                            />
                          </Column>
                        ) : null}
                        <Column style={styles.itemDetailsColumn}>
                          <Text style={styles.itemName}>{item.text}</Text>
                          <Text style={styles.itemMetadata}>{metadata}</Text>
                        </Column>
                        <Column style={styles.itemPriceColumn}>
                          {item.discountedPrice ? (
                            <>
                              <Text style={styles.itemOriginalPrice}>
                                {item.price}
                              </Text>
                              <Text style={styles.itemDiscountedPrice}>
                                {item.discountedPrice}
                              </Text>
                            </>
                          ) : (
                            <Text style={styles.itemPrice}>{item.price}</Text>
                          )}
                        </Column>
                      </Row>
                      {index < items.length - 1 ? (
                        <Hr style={styles.itemDivider} />
                      ) : null}
                    </Section>
                  );
                })}
              </Section>
            ) : (
              <Text style={styles.emptyText}>
                No items were included in this order.
              </Text>
            )}
          </Section>

          <Section style={styles.separatedSection}>
            <SectionHeading>{fulfillmentHeading}</SectionHeading>
            <Text style={styles.fulfillmentDetails}>{delivery_details}</Text>
          </Section>

          <Section style={styles.summarySection}>
            <SectionHeading>Order summary</SectionHeading>
            <SummaryRow label="Subtotal" value={subtotal} />
            {discount ? (
              <SummaryRow label="Discount" value={`-${discount}`} discount />
            ) : null}
            {delivery_fee ? (
              <SummaryRow label="Delivery fee" value={delivery_fee} />
            ) : null}
            <Hr style={styles.summaryDivider} />
            <SummaryRow label="Total" value={order_amount} total />
          </Section>

          <Section style={styles.actionSection}>
            <Button href={appUrl} style={styles.button}>
              <span style={styles.buttonLabel}>View order</span>
              <ArrowUpRight
                aria-hidden="true"
                color={colors.raised}
                size={14}
                strokeWidth={2}
                style={styles.buttonIcon}
              />
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function SectionHeading({ children }: { children: string }) {
  return <Text style={styles.sectionHeading}>{children}</Text>;
}

function SummaryRow({
  label,
  value,
  discount = false,
  total = false,
}: {
  label: string;
  value: string;
  discount?: boolean;
  total?: boolean;
}) {
  return (
    <Row style={total ? styles.totalRow : styles.summaryRow}>
      <Column>
        <Text style={total ? styles.totalLabel : styles.summaryLabel}>
          {label}
        </Text>
      </Column>
      <Column style={styles.summaryValueColumn}>
        <Text
          style={
            total
              ? styles.totalValue
              : discount
                ? styles.discountValue
                : styles.summaryValue
          }
        >
          {value}
        </Text>
      </Column>
    </Row>
  );
}

function formatStatus(value: string) {
  const normalized = value.trim().replaceAll("_", " ");
  if (!normalized) return "Status not recorded";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

export default function NewOrderAdminPreview() {
  return <NewOrderAdmin {...newOrderAdminPreviewProps} />;
}

const fontSans =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const colors = {
  background: "#f6f6f4",
  border: "#e2e3e6",
  discount: "#a24b62",
  foreground: "#1b1c1f",
  muted: "#6f737b",
  raised: "#ffffff",
  surface: "#f8f8f6",
};

const styles: Record<string, CSSProperties> = {
  actionSection: { padding: "24px 32px 32px", textAlign: "right" },
  amount: {
    color: colors.foreground,
    fontSize: "26px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: "32px",
    margin: 0,
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  amountColumn: { textAlign: "right", verticalAlign: "top", width: "180px" },
  body: {
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fontSans,
    margin: 0,
    padding: "36px 0",
  },
  button: {
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
    marginLeft: "8px",
    verticalAlign: "-2px",
  },
  buttonLabel: { verticalAlign: "middle" },
  discountValue: {
    color: colors.discount,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "20px",
    margin: 0,
    textAlign: "right",
  },
  emptyText: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "16px 0 0",
  },
  fulfillmentDetails: {
    color: colors.foreground,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "12px 0 0",
  },
  header: { padding: "36px 32px 26px" },
  itemDetailsColumn: { padding: "15px 16px", verticalAlign: "middle" },
  itemDiscountedPrice: {
    color: colors.foreground,
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: "20px",
    margin: "3px 0 0",
    textAlign: "right",
  },
  itemDivider: { borderColor: colors.border, margin: 0 },
  itemImage: {
    borderRadius: "6px",
    height: "56px",
    objectFit: "cover",
    width: "56px",
  },
  itemImageColumn: { padding: "12px 0", verticalAlign: "middle", width: "56px" },
  itemMetadata: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "17px",
    margin: "4px 0 0",
  },
  itemName: {
    color: colors.foreground,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "19px",
    margin: 0,
  },
  itemOriginalPrice: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "16px",
    margin: 0,
    textAlign: "right",
    textDecoration: "line-through",
  },
  itemPrice: {
    color: colors.foreground,
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: "20px",
    margin: 0,
    textAlign: "right",
  },
  itemPriceColumn: { padding: "15px 0", verticalAlign: "middle", width: "92px" },
  itemRow: { width: "100%" },
  itemsList: { marginTop: "10px" },
  section: { padding: "24px 32px" },
  sectionHeading: {
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
  shell: {
    backgroundColor: colors.raised,
    margin: "0 auto",
    maxWidth: "640px",
    overflow: "hidden",
  },
  statusDetailsColumn: { verticalAlign: "top" },
  statusPanel: {
    backgroundColor: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    borderLeft: "3px solid #2867b2",
    borderTop: `1px solid ${colors.border}`,
    padding: "20px 32px 21px 29px",
  },
  statusSummary: {
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "18px",
    margin: "5px 0 0",
  },
  statusTitle: {
    color: colors.foreground,
    fontSize: "20px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: "26px",
    margin: 0,
  },
  statusValue: {
    color: "#2867b2",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    lineHeight: "17px",
    margin: "8px 0 0",
  },
  storeName: {
    color: colors.foreground,
    fontSize: "30px",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: "35px",
    margin: 0,
  },
  summaryDivider: { borderColor: colors.border, margin: "15px 0" },
  summaryLabel: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "20px",
    margin: 0,
  },
  summaryRow: { marginTop: "12px" },
  summarySection: {
    backgroundColor: colors.surface,
    borderTop: `1px solid ${colors.border}`,
    padding: "24px 32px 26px",
  },
  summaryValue: {
    color: colors.foreground,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "20px",
    margin: 0,
    textAlign: "right",
  },
  summaryValueColumn: { textAlign: "right", width: "160px" },
  title: {
    color: colors.foreground,
    fontSize: "20px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: "26px",
    margin: "14px 0 0",
  },
  totalLabel: {
    color: colors.foreground,
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: "21px",
    margin: 0,
  },
  totalRow: { marginTop: "2px" },
  totalValue: {
    color: colors.foreground,
    fontSize: "22px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: "28px",
    margin: 0,
    textAlign: "right",
  },
};
