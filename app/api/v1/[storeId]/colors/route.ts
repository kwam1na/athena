import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { createColor, fetchColors } from '@/lib/repositories/colorsRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createSupabaseServerClient } from '@/app/api/utils';

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        // const cookieStore = cookies()
        // const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        const body = await req.json();

        const { name, value } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!value) {
            return new NextResponse('Value is required', { status: 400 });
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

        const createParams = { ...body, store_id: params.storeId }
        const color = await createColor(createParams);

        return NextResponse.json(color, res);
    } catch (error) {
        console.log('[COLORS_POST]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(
    req: Request,
    { params }: { params: { storeId: string } },
) {
    try {
        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const colors = await fetchColors(params.storeId);

        return NextResponse.json(colors);
    } catch (error) {
        console.log('[COLORS_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}
