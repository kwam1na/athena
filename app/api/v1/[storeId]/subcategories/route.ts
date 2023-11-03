import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { createSubategory, fetchSubcategories } from '@/lib/repositories/subcategoriesRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/app/api/utils';
import { parse } from 'path';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        const body = await req.json();

        const { name, category_id } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!category_id) {
            return new NextResponse('Category ID is required', {
                status: 400,
            });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const storeId = parseInt(params.storeId)

        const storeByUserId = await findStore({
            id: storeId,
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const createParams = { ...body, store_id: storeId }
        const subcategory = await createSubategory(createParams);

        return NextResponse.json(subcategory);
    } catch (error) {
        console.log('[CATEGORIES_POST]', error);
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

        const subcategories = await fetchSubcategories(parseInt(params.storeId));
        return NextResponse.json(subcategories);
    } catch (error) {
        console.log('[CATEGORIES_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}
