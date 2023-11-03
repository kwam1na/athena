import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { findStore } from '@/lib/repositories/storesRepository';
import { createTransaction, fetchTransactions, getTransaction, updateTransaction } from '@/lib/repositories/transactionsRepository';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/app/api/utils';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        const body = await req.json();
        const { transaction_date, organization_id } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!transaction_date) {
            return new NextResponse('Transaction date is required', { status: 400 });
        }

        if (!organization_id) {
            return new NextResponse('Organization id is required', { status: 400 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const transaction = await createTransaction({ store_id: parseInt(params.storeId), user_id: user.id, transaction_date, organization_id: parseInt(organization_id) })
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
            store_id: parseInt(params.storeId),
        });

        return NextResponse.json(transactions);
    } catch (error) {
        console.log('[TRANSACTION_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        const body = await req.json();

        const { id, ...newParams } = body

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!id) {
            return new NextResponse('Transaction id is required', { status: 400 });
        }

        if (!body.transaction_report_title) {
            return new NextResponse('Transaction report title is required', { status: 400 });
        }

        if (!body.organization_id) {
            return new NextResponse('Organization id is required', { status: 400 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const existingTransaction = await updateTransaction(id, newParams)

        if (!existingTransaction) {
            return new NextResponse('Transaction with id given not found', { status: 404 })
        }

        return NextResponse.json(existingTransaction, res);
    } catch (error) {
        console.log('[TRANSACTION_POST]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
