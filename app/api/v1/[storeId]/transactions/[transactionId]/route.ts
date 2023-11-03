import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { deleteProduct, getProduct, updateProduct } from '@/lib/repositories/productsRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { createTransactionItem, findTransactionItem, getTransactionItem, updateTransactionItem } from '@/lib/repositories/transactionItemsRepository';
import { deleteTransaction, getTransaction, updateTransaction } from '@/lib/repositories/transactionsRepository';
import { cookies } from 'next/headers';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createSupabaseServerClient } from '@/app/api/utils';

export async function POST(
    req: NextRequest,
    { params }: { params: { transactionId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

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
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const existingTransactionItem = await findTransactionItem({ product_id, transaction_id: params.transactionId })

        if (existingTransactionItem) {
            const item = await updateTransactionItem(existingTransactionItem.id, { ...body, cost: parseFloat(body.cost), price: parseFloat(body.price) })
            return NextResponse.json(item, res);
        }

        const transactionItem = await createTransactionItem({ ...body, cost: parseFloat(body.cost), price: parseFloat(body.price), store_id: params.storeId, transaction_id: params.transactionId, user_id: user.id })
        return NextResponse.json(transactionItem, res);
    } catch (error) {
        console.log('[TRANSACTION_POST]', (error as Error).message);
        await updateTransaction(params.transactionId, { status: 'pending-rollback' })
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
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.transactionId) {
            return new NextResponse('Product id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const transaction = await deleteTransaction(params.transactionId);

        return NextResponse.json(transaction, res);
    } catch (error) {
        console.log('[TRANSACTION_DELETE]', (error as Error).message);
        // RECORD DOES NOT EXIST CODE = P2025
        if ((error as any).code === 'P2025') {
            return NextResponse.json({ errorCode: 'P2025', message: 'Record does not exist' }, { status: 500 });
        }

        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { transactionId: string; storeId: string } },
) {
    try {
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

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


        return NextResponse.json({});
    } catch (error) {
        console.log('[TRANSACTION_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
