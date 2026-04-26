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
  _id: string;
  productId: string;
  productSkuId: string;
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
  _id: string;
  transactionNumber: string;
  subtotal: number;
  tax: number;
  total: number;
  hasTrace: boolean;
  sessionTraceId: string | null;
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

export async function getPosTransaction(
  transactionId: string,
): Promise<PosTransaction> {
  const response = await fetch(`${getBaseUrl()}/${transactionId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error fetching transaction.");
  }

  return res;
}
