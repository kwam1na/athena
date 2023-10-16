import prismadb from "@/lib/prismadb";
import { InventoryConstraintError, ProductNotFoundError } from "./errors";
import { getTransaction, updateTransaction } from "@/lib/repositories/transactionsRepository";
import { Transaction } from "./types";
import { Product, TransactionItem } from "@prisma/client";

export const checkIfItemsUpdated = (transaction_items: Partial<TransactionItem>[], existingTransaction?: Transaction) => {

    const existingItemIds = existingTransaction?.transaction_items?.map((item: any) => item.id) || [];
    const updatedItemIds = transaction_items.map((item: any) => item.id);
    const newItemsAdded = updatedItemIds.some((id: string) => !existingItemIds.includes(id));

    const hasUnitsSoldUpdated = existingTransaction?.transaction_items?.some((item: any) => {
        const transactionItem = transaction_items.find((i: any) => i.id === item.id);
        return transactionItem?.units_sold !== item.units_sold;
    });

    const hasTransactionItemsBeenUpdated = hasUnitsSoldUpdated || newItemsAdded;
    return hasTransactionItemsBeenUpdated;
};

export const checkForOffendingItems = ({ existingItem, item, product, offendingItems }:
    {
        existingItem?: Partial<TransactionItem>
        item: Partial<TransactionItem>,
        offendingItems: Record<string, any>[],
        product?: Partial<Product>,
    }) => {

    const unitsSold = item?.units_sold || 0;
    const productCount = product?.inventory_count || 0;
    const reportedUnitsSold = existingItem?.units_sold || 0;

    const inventoryChange = existingItem ? reportedUnitsSold - unitsSold : 0;
    if (inventoryChange < 0 && (!product || Math.abs(inventoryChange) > productCount)) {
        offendingItems.push({
            product_id: item.product_id,
            product_name: item.product_name,
            inventory_count: product?.inventory_count || 0,
            updated_provided_units_sold: item.units_sold,
            existing_units_sold: existingItem?.units_sold
        });
    }

    if (!existingItem && (!product || unitsSold > productCount)) {
        offendingItems.push({
            product_id: item.product_id,
            product_name: item.product_name,
            inventory_count: product?.inventory_count || 0,
            provided_units_sold: item.units_sold
        });
    }
};

export const checkInventoryConstraints = async (prisma: any, hasTransactionItemsBeenUpdated: boolean, transaction_items: Partial<TransactionItem>[], existingTransaction?: Transaction) => {
    const offendingItems: Record<string, any>[] = [];

    const itemsToCheck = hasTransactionItemsBeenUpdated ? transaction_items : (!existingTransaction ? transaction_items : []);

    for (const item of itemsToCheck) {
        let product: Partial<Product> | undefined;
        try {
            product = await prisma.product.findUnique({
                where: { id: item.product_id },
                select: { inventory_count: true },
            });
        } catch (error) {
            console.error("Failed to find product", error);
            throw new ProductNotFoundError('Failed to find product', {
                product_id: item.product_id,
                product_name: item.product_name,
            });
        }

        const existingItem: Partial<TransactionItem> | undefined = existingTransaction?.transaction_items.find((e: any) => e.id === item.id);
        checkForOffendingItems({ existingItem, item, product, offendingItems });
    }

    return { status: 'success', offendingItems };
};

/**
* Using Parital<TransactionItem> because the transaction items from the frontend will
* not have all the fields that are in the TransactionItem type
*/
export const getResult = async (transactionId: string, transaction_items: Partial<TransactionItem>[], transaction_params: Record<string, any>, params: Record<string, any>, userId: string) => {

    if (transaction_items.length === 0) {
        throw new Error('Transaction items cannot be empty');
    }

    return await prismadb.$transaction(async (prisma) => {
        try {
            // Step 0: Check if the transaction has already been published
            const existingTransaction = await getTransaction(transactionId, { status: 'published' }) as Transaction;

            // Check if transaction items have been updated (either units sold updated or new items added)
            const hasTransactionItemsBeenUpdated = checkIfItemsUpdated(transaction_items, existingTransaction)


            // Step 1: Check for inventory constraints
            const result = await checkInventoryConstraints(prisma, hasTransactionItemsBeenUpdated, transaction_items, existingTransaction);

            const { offendingItems } = result;

            if (offendingItems && offendingItems.length > 0) {
                throw new InventoryConstraintError('Inventory constraint violated', offendingItems)
            }

            // Initialize an array to hold created or updated items
            const createdOrUpdatedItems: Record<string, any>[] = [];

            //Step 2: Create or Update Transaction Items and Step 3: Update inventory counts
            const transactionPromises = transaction_items.map(async (item: any) => {
                let existingTransactionItem;
                if (item.id)
                    existingTransactionItem = await prisma.transactionItem.findUnique({
                        where: { id: item.id, AND: [{ product_id: item.product_id }, { transaction_id: item.transaction_id }] },
                    });

                let transactionItem;
                const body = { ...item, cost: parseFloat(item.cost), price: parseFloat(item.price), store_id: params.storeId, user_id: userId }

                if (existingTransactionItem) {
                    const inventoryChange = existingTransactionItem.units_sold - item.units_sold;

                    transactionItem = await prisma.transactionItem.update({
                        where: { id: existingTransactionItem.id },
                        data: body,
                    });

                    await prisma.product.update({
                        where: { id: item.product_id },
                        data: { inventory_count: { increment: inventoryChange } },
                    });
                } else {
                    transactionItem = await prisma.transactionItem.create({
                        data: body,
                    });

                    await prisma.product.update({
                        where: { id: item.product_id },
                        data: { inventory_count: { decrement: item.units_sold } },
                    });
                }

                createdOrUpdatedItems.push(transactionItem)
            });

            await Promise.all(transactionPromises);
            await updateTransaction(transactionId, transaction_params)

            return { status: 'success', transaction_items: createdOrUpdatedItems };

        } catch (error) {
            throw error;
        }
    })
}