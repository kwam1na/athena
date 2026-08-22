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

export interface ExpenseReceiptStoreContact {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface ExpenseReceiptItem {
  name: string;
  totalPrice: string;
  quantityLabel: string;
  skuOrBarcode?: string;
  attributes?: string;
}

export interface ExpenseReceiptEmailProps {
  storeName: string;
  storeContact?: ExpenseReceiptStoreContact;
  reportNumber: string;
  completedDate: string;
  completedTime: string;
  recordedBy?: string;
  registerNumber?: string;
  items: Array<ExpenseReceiptItem>;
  itemsCount: number;
  total: string;
  notes?: string | null;
}

const sectionBorder = {
  borderBottom: "1px dashed #111111",
  paddingBottom: "14px",
  marginBottom: "16px",
};

export default function ExpenseReceiptEmail({
  storeName = "Wigclub",
  storeContact,
  reportNumber,
  completedDate,
  completedTime,
  recordedBy = "Unassigned",
  registerNumber,
  items,
  itemsCount,
  total,
  notes,
}: ExpenseReceiptEmailProps) {
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
            <SectionLabel>Expense report</SectionLabel>
            <LineItem>
              <DateTime date={completedDate} time={completedTime} />
              <Text style={{ ...styles.baseTextStyle, ...styles.receiptId }}>
                #{reportNumber}
              </Text>
            </LineItem>
            <Text style={{ ...styles.baseTextStyle, ...styles.recordedBy }}>
              Recorded by: {recordedBy}
            </Text>
            {registerNumber && (
              <Text style={{ ...styles.baseTextStyle, ...styles.registerNumber }}>
                Register: {registerNumber}
              </Text>
            )}
          </Section>

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
              {itemsCount} item{itemsCount === 1 ? "" : "s"}
            </Text>
            <Hr style={styles.summaryDivider} />
            <Row label="Total value" value={total} valueStyle={styles.total} />
          </Section>

          {notes && (
            <Section style={sectionBorder}>
              <SectionLabel>Notes</SectionLabel>
              <Text style={{ ...styles.baseTextStyle, ...styles.notes }}>
                {notes}
              </Text>
            </Section>
          )}

          <Section>
            <Text style={{ ...styles.baseTextStyle, ...styles.footerLine }}>
              Internal inventory expense record
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
    textTransform: "uppercase",
  },
  baseTextStyle: {
    height: "fit-content",
    margin: "0px",
    fontSize: "12px",
    lineHeight: "18px",
  },
  contactBlock: {
    textAlign: "center",
    marginBottom: "4px",
  },
  contact: {
    fontSize: "10px",
    lineHeight: "15px",
    margin: "1px 0",
    textTransform: "uppercase",
  },
  sectionHeading: {
    borderBottom: "1px solid #111111",
    fontWeight: 700,
    fontSize: "10px",
    letterSpacing: "1.6px",
    marginBottom: "10px",
    paddingBottom: "4px",
    textTransform: "uppercase",
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
    textAlign: "right",
  },
  recordedBy: {
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
    textTransform: "uppercase",
  },
  rowValue: {
    fontWeight: 700,
    textAlign: "right",
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
    textTransform: "uppercase",
  },
  itemPrice: {
    whiteSpace: "nowrap",
    fontWeight: 900,
    textAlign: "right",
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
    textTransform: "uppercase",
  },
  itemAttribute: {
    color: "#555555",
    fontSize: "10px",
    lineHeight: "15px",
    textTransform: "uppercase",
  },
  itemCount: {
    color: "#444444",
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "1px",
    marginBottom: "8px",
    textTransform: "uppercase",
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
  notes: {
    fontSize: "11px",
    lineHeight: "16px",
  },
  footerLine: {
    textAlign: "center",
    fontSize: "11px",
    fontWeight: 700,
    margin: "4px 0",
  },
};
