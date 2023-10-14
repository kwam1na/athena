import { getSession } from '@auth0/nextjs-auth0';
import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prismadb';
import { getTransaction, updateTransaction } from '@/lib/repositories/transactionsRepository';

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {

        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();
        const { transaction_items, transaction, transaction_details } = body;

        const transaction_params = { transaction_report_title: transaction.reportTitle, ...transaction_details, status: 'published' }

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        // Start a transaction
        const result = await prismadb.$transaction(async (prisma) => {

            // Step 0: Check if the transaction has already been published
            const existingTransaction = await getTransaction(transaction.id, { status: 'published' });

            // If the transaction has already been published, check if the transaction items have been updated
            // Check if the units sold have been updated or if new items have been added

            const existingItemIds = existingTransaction?.transaction_items?.map((item: any) => item.id) || [];
            const updatedItemIds = transaction_items.map((item: any) => item.id);
            const newItemsAdded = updatedItemIds.some((id: string) => !existingItemIds.includes(id));

            // Find items where units sold have been updated
            const hasUnitsSoldUpdated = existingTransaction?.transaction_items?.some((item: any) => {
                const transactionItem = transaction_items.find((i: any) => i.id === item.id);
                return transactionItem?.units_sold !== item.units_sold;
            });

            // Check if transaction items have been updated (either units sold updated or new items added)
            const hasTransactionItemsBeenUpdated = hasUnitsSoldUpdated || newItemsAdded;


            // Step 1: Check for inventory constraints
            const offendingItems = [];

            if (hasTransactionItemsBeenUpdated) {

                // If transaction items have been updated, check if the inventory count is sufficient
                // will need to use the difference between the existing units sold on the published transaction and the new units sold
                // to determine the inventory change

                for (const item of transaction_items) {
                    const product = await prisma.product.findUnique({
                        where: { id: item.product_id },
                        select: { count: true },
                    });

                    const existingItem = existingTransaction?.transaction_items.find((e: any) => e.id === item.id);
                    const inventoryChange = existingItem ? existingItem.units_sold - item.units_sold : 0;

                    // positive inventory change means inventory is being added back
                    // negative inventory change means inventory is being removed

                    if (inventoryChange < 0) {
                        if (!product || Math.abs(inventoryChange) > product.count) {
                            offendingItems.push({ product_id: item.product_id, product_name: item.product_name, inventory_count: product?.count || 0, updated_units_sold: item.units_sold, existing_units_sold: existingItem?.units_sold });
                        }
                    }

                    if (!existingItem) {
                        // this is a new item added to the published report
                        if (!product || item.units_sold > product.count) {
                            offendingItems.push({ product_id: item.product_id, product_name: item.product_name, inventory_count: product?.count || 0, updated_units_sold: item.units_sold });
                        }
                    }
                }

            }

            if (!existingTransaction) {

                for (const item of transaction_items) {
                    const product = await prisma.product.findUnique({
                        where: { id: item.product_id },
                        select: { count: true },
                    });

                    if (!product || item.units_sold > product.count) {
                        offendingItems.push({ product_id: item.product_id, product_name: item.product_name, inventory_count: product?.count || 0, updated_units_sold: item.units_sold });
                    }
                }

            }

            if (offendingItems.length > 0) {
                return { status: 'constraint_violated', offendingItems };
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
                const body = { ...item, cost: parseFloat(item.cost), price: parseFloat(item.price), store_id: params.storeId, user_id: user.sub }

                if (existingTransactionItem) {
                    // Calculate the inventory change
                    const inventoryChange = existingTransactionItem.units_sold - item.units_sold;
                    console.log("inventory change for item", item.product_name, inventoryChange)

                    //Update transaction item
                    transactionItem = await prisma.transactionItem.update({
                        where: { id: existingTransactionItem.id },
                        data: body,
                    });

                    // Update inventory
                    await prisma.product.update({
                        where: { id: item.product_id },
                        data: { count: { increment: inventoryChange } },
                    });
                } else {
                    // Create new transaction item
                    transactionItem = await prisma.transactionItem.create({
                        data: body,
                    });

                    // Update inventory
                    await prisma.product.update({
                        where: { id: item.product_id },
                        data: { count: { decrement: item.units_sold } },
                    });
                }

                createdOrUpdatedItems.push(transactionItem)
            });

            await Promise.all(transactionPromises);
            await updateTransaction(transaction.id, transaction_params)

            return { status: 'success', transaction_items: createdOrUpdatedItems };
        });

        if (result.status === 'constraint_violated') {
            return NextResponse.json({
                message: 'Inventory constraint violated',
                offendingItems: result.offendingItems,
            }, { status: 400 });
        }

        return NextResponse.json({ message: 'Report published successfully', transactionItems: result.transaction_items }, res)

    } catch (error) {
        console.log('[PUBLISH_REPORT]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}