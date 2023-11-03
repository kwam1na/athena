import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { findStore } from '@/lib/repositories/storesRepository';
import { createTransactionItem, fetchTransactionItems } from '@/lib/repositories/transactionItemsRepository';
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
        const { category_id, subcategory_id, product_id, product_name, price, cost, units_sold, transaction_id, transaction_date } = body;

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

        if (!transaction_id) {
            return new NextResponse('Transaction id is required', { status: 400 });
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

        const transactionItem = await createTransactionItem({ ...body, store_id: params.storeId, user_id: user.id })
        return NextResponse.json(transactionItem, res);
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

        const transactionItems = await fetchTransactionItems({
            store_id: params.storeId,
        });

        return NextResponse.json(transactionItems);
    } catch (error) {
        console.log('[TRANSACTION_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}