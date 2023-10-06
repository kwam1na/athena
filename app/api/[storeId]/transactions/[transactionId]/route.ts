import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { deleteProduct, getProduct, updateProduct } from '@/lib/repositories/productsRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { createTransactionItem, findTransactionItem, getTransactionItem, updateTransactionItem } from '@/lib/repositories/transactionItemsRepository';
import { deleteTransaction, getTransaction } from '@/lib/repositories/transactionsRepository';

export async function POST(
    req: NextRequest,
    { params }: { params: { transactionId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();
        const { category_id, subcategory_id, product_id, product_name, price, cost, units_sold, sku, transaction_date } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!category_id) {
            return new NextResponse('Category id is required', { status: 400 });
        }

        if (!subcategory_id) {
            return new NextResponse('Subcategory id is required', { status: 400 });
        }

        if (!product_id) {
            return new NextResponse('Product id is required', { status: 400 });
        }

        if (!product_name) {
            return new NextResponse('Product name is required', { status: 400 });
        }

        if (!price) {
            return new NextResponse('Price is required', { status: 400 });
        }

        if (!cost) {
            return new NextResponse('Cost is required', { status: 400 });
        }

        if (!units_sold) {
            return new NextResponse('Units sold is required', { status: 400 });
        }

        if (!sku) {
            return new NextResponse('SKU is required', { status: 400 });
        }

        if (!transaction_date) {
            return new NextResponse('Transaction date is required', { status: 400 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            user_id: user.sub,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const existingTransactionItem = await findTransactionItem({ product_id, transaction_id: params.transactionId })

        if (existingTransactionItem) {
            const item = await updateTransactionItem(existingTransactionItem.id, { units_sold: existingTransactionItem.units_sold + units_sold })
            return NextResponse.json(item, res);
        }

        const transactionItem = await createTransactionItem({ ...body, store_id: params.storeId, transaction_id: params.transactionId, user_id: user.sub })
        return NextResponse.json(transactionItem, res);
    } catch (error) {
        console.log('[TRANSACTION_POST]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(
    req: Request,
    { params }: { params: { transactionId: string } },
) {
    try {
        if (!params.transactionId) {
            return new NextResponse('Transaction id is required', { status: 400 });
        }

        const transaction = await getTransaction(params.transactionId);
        return NextResponse.json(transaction);
    } catch (error) {
        console.log('[TRANSACTION_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { transactionId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        console.log('params in DELETE:', params)

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.transactionId) {
            return new NextResponse('Product id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            user_id: user.sub,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const transaction = await deleteTransaction(params.transactionId);

        return NextResponse.json(transaction, res);
    } catch (error) {
        console.log('[TRANSACTION_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { productId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();

        const {
            name,
            price,
            count,
            cost_per_item,
            category_id,
            subcategory_id,
            images,
        } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.productId) {
            return new NextResponse('Product id is required', { status: 400 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        // if (!images || !images.length) {
        //     return new NextResponse('Images are required', { status: 400 });
        // }

        if (!price) {
            return new NextResponse('Price is required', { status: 400 });
        }

        if (!cost_per_item) {
            return new NextResponse('Cost per item is required', { status: 400 });
        }

        if (!count) {
            return new NextResponse('Count is required', { status: 400 });
        }

        if (!category_id) {
            return new NextResponse('Category id is required', { status: 400 });
        }

        if (!subcategory_id) {
            return new NextResponse('Subcategory id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            user_id: user.sub,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        // await prismadb.product.update({
        //     where: {
        //         id: params.productId,
        //     },
        //     data: {
        //         name,
        //         price,
        //         costPerItem,
        //         count,
        //         categoryId,
        //         subcategoryId,
        //         colorId,
        //         sizeId,
        //         images: {
        //             deleteMany: {},
        //         },
        //         isFeatured,
        //         isArchived,
        //     },
        // });

        // const product = await prismadb.product.update({
        //     where: {
        //         id: params.productId,
        //     },
        //     data: {
        //         images: {
        //             createMany: {
        //                 data: [
        //                     ...images.map((image: { url: string }) => image),
        //                 ],
        //             },
        //         },
        //     },
        // });
        const product = await updateProduct(params.productId, body)

        return NextResponse.json(product);
    } catch (error) {
        console.log('[TRANSACTION_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
