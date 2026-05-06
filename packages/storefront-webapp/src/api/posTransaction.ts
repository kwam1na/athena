import config from "@/config";

export type PosTransactionPayment = {
  method: string;
  amount: number;
  timestamp: number;
};

type PosTransactionPerson = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
};

export type PosTransactionItem = {
  productName: string;
  productSku: string;
  barcode?: string;
  image?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount?: number;
  discountReason?: string;
};

export type PosTransaction = {
  _id?: string;
  transactionNumber: string;
  subtotal: number;
  tax: number;
  total: number;
  hasTrace?: boolean;
  sessionTraceId?: string | null;
  registerNumber?: string;
  registerSessionId?: string;
  paymentMethod?: string;
  payments: PosTransactionPayment[];
  totalPaid: number;
  changeGiven?: number;
  status: string;
  completedAt: number;
  notes?: string;
  cashier: PosTransactionPerson | null;
  customer: PosTransactionPerson | null;
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  items: PosTransactionItem[];
};

const getBaseUrl = () => `${config.apiGateway.URL}/pos-transactions`;

export class PosTransactionReceiptError extends Error {
  status?: number;

  constructor(message: string, options: { status?: number } = {}) {
    super(message);
    this.name = "PosTransactionReceiptError";
    this.status = options.status;
  }
}

async function fetchPosTransaction(url: string): Promise<PosTransaction> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new PosTransactionReceiptError(
      res.error || "Error fetching transaction.",
      { status: response.status },
    );
  }

  return res;
}

export async function getPosTransactionByReceiptToken(
  token: string,
): Promise<PosTransaction> {
  return fetchPosTransaction(
    `${getBaseUrl()}/receipt-shares/${encodeURIComponent(token)}`,
  );
}
