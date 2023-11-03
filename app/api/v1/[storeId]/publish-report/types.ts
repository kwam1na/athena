import { transaction_item } from "@prisma/client";

export type Transaction = {
    id: string;
    transaction_items: Partial<transaction_item>[];
}