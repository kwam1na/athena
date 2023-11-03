import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prismadb';
import { createStore, getStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/app/api/utils';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function POST(req: NextRequest) {
    try {
        const res = new NextResponse();
        const supabase = createSupabaseServerClient();

        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        const body = await req.json();

        const { name, currency } = body;

        if (!user) {
            return new NextResponse('Unauthorized', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!currency) {
            return new NextResponse('Currency is required', { status: 400 });
        }

        if (!body.organization_id) {
            return new NextResponse('Organization id is required', { status: 400 });
        }

        // set the low_stock_threshold to 10 by default for all new stores
        const settings = {
            low_stock_threshold: 10,
        }

        const createParams = { ...body, organization_id: parseInt(body.organization_id), created_by: user.id, settings }
        const store = await createStore(createParams);

        await prismadb.user.update({
            where: {
                id: user.id,
            },
            data: {
                store_id: store.id,
            }
        })

        return NextResponse.json(store, res);
    } catch (error) {
        console.log('[STORES_POST]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}




