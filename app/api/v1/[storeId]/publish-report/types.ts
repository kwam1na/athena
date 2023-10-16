import { TransactionItem } from "@prisma/client";

export type Transaction = {
    id: string;
    transaction_items: Partial<TransactionItem>[];
}