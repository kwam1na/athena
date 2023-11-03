import { getSession } from '@auth0/nextjs-auth0';
import { NextRequest, NextResponse } from 'next/server';
import { GenericTransactionError, InventoryConstraintError, ProductNotFoundError } from './errors';
import { getResult } from './utils';
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
        const { transaction_items, transaction, transaction_details } = body;

        const transaction_params = { transaction_report_title: transaction.reportTitle, ...transaction_details, status: 'published' }

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        const result = await getResult(transaction.id, transaction_items, transaction_params, params, user.id)

        return NextResponse.json({ message: 'Report published successfully', transactionItems: result.transaction_items }, res)

    } catch (error) {
        console.log('[PUBLISH_REPORT]', (error as Error).message);

        if (error instanceof InventoryConstraintError) {
            return NextResponse.json({
                message: error.message,
                offendingItems: error.offendingItems,
            }, { status: 400 });
        }

        if (error instanceof ProductNotFoundError) {
            return NextResponse.json({
                message: error.message,
                details: error.details,
            }, { status: 400 });
        }

        if (error instanceof GenericTransactionError) {
            return NextResponse.json({
                message: error.message,
                details: error.details,
            }, { status: 400 });
        }

        return new NextResponse('Internal error', { status: 500 });
    }
}