import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Section,
  Text,
} from "@react-email/components";

export interface PosReceiptCustomerInfo {
  name?: string;
  email?: string;
  phone?: string;
}

export interface PosReceiptStoreContact {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface PosReceiptItem {
  name: string;
  totalPrice: string;
  quantityLabel: string;
  skuOrBarcode?: string;
  attributes?: string;
}

export interface PosReceiptPayment {
  method: string;
  amount: string; // Formatted amount string
}

export interface PosReceiptEmailProps {
  storeName: string;
  storeContact?: PosReceiptStoreContact;
  receiptNumber: string;
  completedDate: string;
  completedTime: string;
  registerNumber?: string;
  cashierName?: string;
  customerInfo?: PosReceiptCustomerInfo;
  items: Array<PosReceiptItem>;
  itemsCount: number;
  subtotal: string;
  tax?: string;
  total: string;
  paymentMethodLabel: string;
  payments?: Array<PosReceiptPayment>;
  amountPaid?: string;
  changeGiven?: string;
}

const sectionBorder = {
  borderBottom: "1px dashed #111111",
  paddingBottom: "14px",
  marginBottom: "16px",
};

const mockItems: Array<PosReceiptItem> = [
  {
    name: "Product 1",
    totalPrice: "$10.00",
    quantityLabel: "1 x $10.00",
    skuOrBarcode: "1234567890",
  },
  {
    name: "Product 2",
    totalPrice: "$20.00",
    quantityLabel: "2 x $10.00",
    skuOrBarcode: "1234567891",
  },
  {
    name: "Product 3",
    totalPrice: "$30.00",
    quantityLabel: "3 x $10.00",
    skuOrBarcode: "1234567892",
  },
  {
    name: "Product 4",
    totalPrice: "$40.00",
    quantityLabel: "4 x $10.00",
    skuOrBarcode: "1234567893",
  },
];

export default function PosReceiptEmail({
  storeName = "Wigclub",
  storeContact = {
    street: "2 Jungle Avenue",
    city: "East Legon",
    state: "Accra",
    country: "Ghana",
    phone: "+233555555555",
    website: "www.wigclub.store",
  },
  receiptNumber = "346372",
  completedDate = "01/12/2025",
  completedTime = "3:27 PM",
  cashierName = "John D.",
  registerNumber,
  customerInfo,
  items = mockItems,
  itemsCount = 4,
  subtotal = "GHS 2,720",
  tax,
  total = "GHS 2,720",
  paymentMethodLabel = "Card Payment",
  payments,
  amountPaid,
  changeGiven,
}: PosReceiptEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={sectionBorder}>
            <Text style={{ ...styles.baseTextStyle, ...styles.storeName }}>
              {storeName}
            </Text>
            {storeContact && (
              <div style={styles.contactBlock}>
                {storeContact.street && (
                  <Text style={{ ...styles.baseTextStyle, ...styles.contact }}>
                    {storeContact.street}
                  </Text>
                )}
                {(storeContact.city ||
                  storeContact.state ||
                  storeContact.zipCode) && (
                  <Text style={{ ...styles.baseTextStyle, ...styles.contact }}>
                    {[
                      storeContact.city,
                      storeContact.state,
                      storeContact.zipCode,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </Text>
                )}
                {storeContact.country && (
                  <Text style={{ ...styles.baseTextStyle, ...styles.contact }}>
                    {storeContact.country}
                  </Text>
                )}
                {storeContact.phone && (
                  <Text style={{ ...styles.baseTextStyle, ...styles.contact }}>
                    Tel {storeContact.phone}
                  </Text>
                )}
                {storeContact.email && (
                  <Text style={{ ...styles.baseTextStyle, ...styles.contact }}>
                    Email: {storeContact.email}
                  </Text>
                )}
                {storeContact.website && (
                  <Text style={{ ...styles.baseTextStyle, ...styles.contact }}>
                    {storeContact.website}
                  </Text>
                )}
              </div>
            )}
          </Section>

          <Section style={sectionBorder}>
            <Block>
              <LineItem>
                <DateTime date={completedDate} time={completedTime} />
                <Text style={{ ...styles.baseTextStyle, ...styles.receiptId }}>
                  #{receiptNumber}
                </Text>
              </LineItem>
              {cashierName && (
                <Text
                  style={{ ...styles.baseTextStyle, ...styles.cashierName }}
                >
                  Cashier: {cashierName}
                </Text>
              )}
              {registerNumber && (
                <Text
                  style={{ ...styles.baseTextStyle, ...styles.registerNumber }}
                >
                  Register: {registerNumber}
                </Text>
              )}
            </Block>
          </Section>

          {customerInfo &&
            (customerInfo.name || customerInfo.email || customerInfo.phone) && (
              <Section style={sectionBorder}>
                <SectionLabel>Customer</SectionLabel>
                {customerInfo.name && (
                  <Row label="Name" value={customerInfo.name} />
                )}
                {customerInfo.email && (
                  <Row
                    label="Email"
                    value={customerInfo.email}
                    valueStyle={styles.emailText}
                  />
                )}
                {customerInfo.phone && (
                  <Row label="Phone" value={customerInfo.phone} />
                )}
              </Section>
            )}

          <Section style={sectionBorder}>
            <SectionLabel>Items</SectionLabel>
            {items.map((item, index) => (
              <div key={`${item.name}-${index}`} style={styles.itemBlock}>
                <div style={styles.itemTopRow}>
                  <Text style={{ ...styles.baseTextStyle, ...styles.itemName }}>
                    {item.name}
                  </Text>
                  <Text
                    style={{ ...styles.baseTextStyle, ...styles.itemPrice }}
                  >
                    {item.totalPrice}
                  </Text>
                </div>
                <div style={styles.itemMetaRow}>
                  <Text style={{ ...styles.baseTextStyle, ...styles.itemMeta }}>
                    {item.quantityLabel}
                  </Text>
                  {item.skuOrBarcode && (
                    <Text style={{ ...styles.baseTextStyle, ...styles.itemMeta }}>
                      {item.skuOrBarcode}
                    </Text>
                  )}
                </div>
                {item.attributes && (
                  <Text
                    style={{ ...styles.baseTextStyle, ...styles.itemAttribute }}
                  >
                    {item.attributes}
                  </Text>
                )}
              </div>
            ))}
          </Section>

          <Section style={sectionBorder}>
            <SectionLabel>Summary</SectionLabel>
            <Text style={{ ...styles.baseTextStyle, ...styles.itemCount }}>
              {itemsCount} item{itemsCount > 1 ? "s" : ""}
            </Text>
            <Row label="Subtotal" value={subtotal} />
            {tax && <Row label="Tax" value={tax} />}
            <Hr style={styles.summaryDivider} />
            <Row label="Total" value={total} valueStyle={styles.total} />
          </Section>

          <Section style={sectionBorder}>
            <SectionLabel>Payment</SectionLabel>
            {payments && payments.length > 0 ? (
              <>
                {payments.map((payment, index) => {
                  const methodLabel =
                    payment.method === "cash"
                      ? "Cash"
                      : payment.method === "card"
                        ? "Card"
                        : payment.method === "mobile_money"
                          ? "Mobile Money"
                          : payment.method
                              .replace("_", " ")
                              .replace(/\b\w/g, (l) => l.toUpperCase());
                  return (
                    <Row
                      key={index}
                      label={methodLabel}
                      value={payment.amount}
                      valueStyle={styles.paymentMethod}
                    />
                  );
                })}
                {amountPaid && (
                  <Row
                    label="Tendered"
                    value={amountPaid}
                    valueStyle={styles.paymentMethod}
                  />
                )}
                {changeGiven && (
                  <Row
                    label="Change"
                    value={changeGiven}
                    valueStyle={styles.paymentMethod}
                  />
                )}
              </>
            ) : (
              <Row
                label={paymentMethodLabel}
                value={total}
                valueStyle={styles.paymentMethod}
              />
            )}
          </Section>

          <Spacer height={16} />

          <Section>
            <Text style={{ ...styles.baseTextStyle, ...styles.footerLine }}>
              Thank you for your business!
            </Text>
            <Text style={{ ...styles.baseTextStyle, ...styles.footerLine }}>
              Please keep this receipt for your records.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function Row({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: CSSProperties;
}) {
  return (
    <div style={styles.row}>
      <Text style={{ ...styles.baseTextStyle, ...styles.rowLabel }}>
        {label}
      </Text>
      <Text
        style={{ ...styles.baseTextStyle, ...styles.rowValue, ...valueStyle }}
      >
        {value}
      </Text>
    </div>
  );
}

function DateTime({ date, time }: { date: string; time: string }) {
  return (
    <div style={styles.dateTime}>
      <Text style={{ ...styles.baseTextStyle, ...styles.transactionDate }}>
        {date}
      </Text>
      <Text style={{ ...styles.baseTextStyle, ...styles.transactionDate }}>
        {time}
      </Text>
    </div>
  );
}

function LineItem({ children }: { children: ReactNode }) {
  return <div style={styles.lineItem}>{children}</div>;
}

function Block({ children }: { children: ReactNode }) {
  return <div style={styles.block}>{children}</div>;
}

function Spacer({ height = 16 }: { height?: number }) {
  return <div style={{ height: `${height}px` }} />;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text style={{ ...styles.baseTextStyle, ...styles.sectionHeading }}>
      {children}
    </Text>
  );
}

const styles: Record<string, CSSProperties> = {
  body: {
    backgroundColor: "#ffffff",
    fontFamily: "'Courier New', monospace",
    color: "#000000",
  },
  container: {
    border: "1px solid #111111",
    borderRadius: "0px",
    maxWidth: "320px",
    margin: "0 auto",
    padding: "18px 16px",
  },
  storeName: {
    textAlign: "center",
    fontWeight: 900,
    fontSize: "22px",
    lineHeight: "26px",
    marginBottom: "10px",
    textTransform: "uppercase" as const,
  },
  block: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0px",
  },
  baseTextStyle: {
    height: "fit-content",
    margin: "0px",
    fontSize: "12px",
    lineHeight: "18px",
  },
  contactBlock: {
    textAlign: "center" as const,
    marginBottom: "4px",
  },
  contact: {
    fontSize: "10px",
    lineHeight: "15px",
    margin: "1px 0",
    textTransform: "uppercase" as const,
  },
  sectionHeading: {
    borderBottom: "1px solid #111111",
    fontWeight: 700,
    fontSize: "10px",
    letterSpacing: "1.6px",
    marginBottom: "10px",
    paddingBottom: "4px",
    textTransform: "uppercase" as const,
  },
  dateTime: {
    display: "flex",
    gap: "8px",
    fontWeight: 900,
  },
  lineItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    marginBottom: "8px",
  },
  transactionDate: {
    fontSize: "12px",
    fontWeight: 800,
    lineHeight: "18px",
  },
  receiptId: {
    fontSize: "12px",
    letterSpacing: "1.5px",
    lineHeight: "18px",
    textAlign: "right" as const,
  },
  cashierName: {
    fontSize: "12px",
    lineHeight: "18px",
    marginTop: "0px",
  },
  registerNumber: {
    fontSize: "11px",
    lineHeight: "17px",
    marginTop: "2px",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "5px",
  },
  rowLabel: {
    color: "#444444",
    fontWeight: 700,
    marginRight: "8px",
    textTransform: "uppercase" as const,
  },
  rowValue: {
    fontWeight: 700,
    textAlign: "right" as const,
  },
  emailText: {
    fontSize: "10px",
    lineHeight: "15px",
  },
  itemBlock: {
    borderBottom: "1px dotted #888888",
    paddingBottom: "10px",
    marginBottom: "10px",
  },
  itemTopRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    fontWeight: 700,
  },
  itemName: {
    fontWeight: 700,
    maxWidth: "190px",
    textTransform: "uppercase" as const,
  },
  itemPrice: {
    whiteSpace: "nowrap" as const,
    fontWeight: 900,
    textAlign: "right" as const,
  },
  itemMetaRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    marginTop: "0px",
    paddingTop: "0px",
  },
  itemMeta: {
    color: "#555555",
    fontSize: "10px",
    lineHeight: "15px",
    textTransform: "uppercase" as const,
  },
  itemAttribute: {
    color: "#555555",
    fontSize: "10px",
    lineHeight: "15px",
    textTransform: "uppercase" as const,
  },
  itemCount: {
    color: "#444444",
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "1px",
    marginBottom: "8px",
    textTransform: "uppercase" as const,
  },
  summaryDivider: {
    borderColor: "#111111",
    margin: "10px 0",
  },
  total: {
    fontSize: "16px",
    fontWeight: 900,
    lineHeight: "22px",
  },
  paymentMethod: {
    fontWeight: 900,
  },
  footerLine: {
    textAlign: "center" as const,
    fontSize: "11px",
    fontWeight: 700,
    margin: "4px 0",
  },
  footerLineMuted: {
    textAlign: "center" as const,
    color: "#666666",
    marginTop: "10px",
  },
  footerDivider: {
    borderColor: "#eeeeee",
    margin: "16px 0",
  },
};
