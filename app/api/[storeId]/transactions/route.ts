import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { findStore } from '@/lib/repositories/storesRepository';
import { createTransaction, fetchTransactions } from '@/lib/repositories/transactionsRepository';

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();
        const { transaction_date } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
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

        const transaction = await createTransaction({ store_id: params.storeId, user_id: user.sub, transaction_date })
        return NextResponse.json(transaction, res);
    } catch (error) {
        console.log('[TRANSACTION_POST]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(
    req: Request,
    { params }: { params: { storeId: string } },
) {
    try {
        // const { searchParams } = new URL(req.url);
        // const category_id = searchParams.get('categoryId') || undefined;
        // const color_id = searchParams.get('colorId') || undefined;
        // const size_id = searchParams.get('sizeId') || undefined;
        // const is_featured = searchParams.get('isFeatured');

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const transactions = await fetchTransactions({
            store_id: params.storeId,
        });

        return NextResponse.json(transactions);
    } catch (error) {
        console.log('[TRANSACTION_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
