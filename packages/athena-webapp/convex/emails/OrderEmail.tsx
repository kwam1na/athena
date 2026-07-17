import type { CSSProperties } from "react";
import {
  Body,
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

export type OrderEmailType = "confirmation" | "ready" | "complete" | "canceled";

interface OrderItem {
  text: string;
  image: string;
  price: string;
  discountedPrice?: string;
  savings?: string;
  quantity: string;
  length?: string;
  color: string;
}

export interface OrderEmailProps {
  type: OrderEmailType;
  customerEmail: string;
  store_name: string;
  order_number: string;
  order_date: string;
  order_status_messaging: string;
  total: string;
  subtotal: string;
  delivery_fee?: string;
  discount?: string;
  items: OrderItem[];
  pickup_type: string;
  pickup_details: string;
  customer_name: string;
}

export const orderEmailPreviewProps = {
  type: "confirmation",
  customerEmail: "john@example.com",
  store_name: "Wigclub",
  order_number: "WC-001",
  order_date: "July 17, 2026",
  order_status_messaging:
    "We received your order and will let you know when it is ready.",
  total: "$100.00",
  subtotal: "$120.00",
  delivery_fee: "$5.00",
  discount: "$25.00",
  items: [
    {
      text: "Sample Product",
      image:
        "https://images.wigclub.store/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/1d23a4ff-7f3c-4c8e-c7d2-6efc6a217079.webp",
      price: "$50.00",
      discountedPrice: "$45.00",
      savings: "$10.00",
      quantity: "2",
      color: "Black",
      length: "16 inches",
    },
    {
      text: "Another Product",
      image:
        "https://images.wigclub.store/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/1d23a4ff-7f3c-4c8e-c7d2-6efc6a217079.webp",
      price: "$30.00",
      quantity: "1",
      color: "Brown",
    },
  ],
  pickup_type: "Delivery",
  pickup_details: "123 Main Street, Accra",
  customer_name: "John",
} satisfies OrderEmailProps;

const statusContent: Record<
  OrderEmailType,
  { accent: string; greeting: (name: string) => string; title: string }
> = {
  confirmation: {
    accent: "#2d7d4f",
    greeting: (name) => `Thanks for your order, ${name}`,
    title: "Order confirmed",
  },
  ready: {
    accent: "#2867b2",
    greeting: (name) => `Your order is ready, ${name}`,
    title: "Your order is ready",
  },
  complete: {
    accent: "#2d7d4f",
    greeting: (name) => `Thanks for shopping with us, ${name}`,
    title: "Order complete",
  },
  canceled: {
    accent: "#b5483f",
    greeting: (name) => `An update about your order, ${name}`,
    title: "Order canceled",
  },
};

export function OrderEmail({
  type,
  customerEmail,
  store_name,
  order_number,
  order_date,
  order_status_messaging,
  total,
  subtotal,
  delivery_fee,
  discount,
  items,
  pickup_type,
  pickup_details,
  customer_name,
}: OrderEmailProps) {
  const status = statusContent[type];
  const customerName = customer_name.trim() || "there";
  const previewText = `${store_name}: ${status.title} · ${order_number}`;
  const fulfillmentHeading = `${pickup_type} details`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.shell}>
          <Section style={styles.header}>
            <Text style={styles.storeName}>{store_name}</Text>
            <Text style={styles.greeting}>{status.greeting(customerName)}</Text>
          </Section>

          <Section
            style={{
              ...styles.statusPanel,
              borderLeft: `3px solid ${status.accent}`,
            }}
          >
            <Text style={styles.statusTitle}>{status.title}</Text>
            <Text style={styles.statusMessage}>{order_status_messaging}</Text>
          </Section>

          <Section style={styles.section}>
            <SectionHeading>Order details</SectionHeading>
            <Row style={styles.detailGrid}>
              <Column style={styles.detailColumn}>
                <Text style={styles.detailLabel}>Order number</Text>
                <Text style={styles.detailValue}>{order_number}</Text>
              </Column>
              <Column style={styles.detailColumn}>
                <Text style={styles.detailLabel}>Ordered on</Text>
                <Text style={styles.detailValue}>{order_date}</Text>
              </Column>
            </Row>
          </Section>

          <Section style={styles.separatedSection}>
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
                        <Column style={styles.itemImageColumn}>
                          {item.image ? (
                            <Img
                              src={item.image}
                              alt={item.text}
                              style={styles.itemImage}
                            />
                          ) : null}
                        </Column>
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
            <Text style={styles.fulfillmentDetails}>{pickup_details}</Text>
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
            <SummaryRow label="Total" value={total} total />
          </Section>

          <Section style={styles.footer}>
            <Text style={styles.footerThankYou}>
              Thank you for shopping with {store_name}.
            </Text>
            <Text style={styles.footerText}>
              This order update was sent to {customerEmail}.
              <br />2 Jungle Avenue, East Legon · Accra, Ghana
            </Text>
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

export default function OrderEmailPreview() {
  return <OrderEmail {...orderEmailPreviewProps} />;
}

const fontSans =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const colors = {
  background: "#f6f6f4",
  border: "#e2e3e6",
  foreground: "#1b1c1f",
  muted: "#6f737b",
  raised: "#ffffff",
  surface: "#f8f8f6",
  discount: "#a24b62",
};

const styles: Record<string, CSSProperties> = {
  body: {
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fontSans,
    margin: 0,
    padding: "36px 0",
  },
  detailColumn: {
    paddingRight: "24px",
    verticalAlign: "top",
    width: "50%",
  },
  detailGrid: { marginTop: "18px" },
  detailLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.05em",
    lineHeight: "15px",
    margin: "0 0 5px",
    textTransform: "uppercase",
  },
  detailValue: {
    color: colors.foreground,
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: "20px",
    margin: 0,
  },
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
  footer: {
    borderTop: `1px solid ${colors.border}`,
    padding: "24px 32px 30px",
  },
  footerThankYou: {
    color: colors.foreground,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "20px",
    margin: "0 0 7px",
  },
  footerText: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "17px",
    margin: 0,
  },
  fulfillmentDetails: {
    color: colors.foreground,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "12px 0 0",
  },
  greeting: {
    color: colors.foreground,
    fontSize: "20px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: "26px",
    margin: "14px 0 0",
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
  section: { padding: "26px 32px" },
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
  statusMessage: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "6px 0 0",
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    borderTop: `1px solid ${colors.border}`,
    padding: "20px 32px 21px 29px",
  },
  statusTitle: {
    color: colors.foreground,
    fontSize: "20px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: "26px",
    margin: 0,
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
