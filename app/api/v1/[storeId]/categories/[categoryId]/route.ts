import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { deleteCategory, getCategory, updateCategory } from '@/lib/repositories/categoriesRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createSupabaseServerClient } from '@/app/api/utils';

export async function GET(
    req: Request,
    { params }: { params: { categoryId: string } },
) {
    try {
        if (!params.categoryId) {
            return new NextResponse('Category id is required', { status: 400 });
        }

        const category = await getCategory(params.categoryId)

        return NextResponse.json(category);
    } catch (error) {
        console.log('[CATEGORY_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { categoryId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const cookieStore = cookies()
        // const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.categoryId) {
            return new NextResponse('Category id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const category = await deleteCategory(params.categoryId)

        return NextResponse.json(category, res);
    } catch (error) {
        console.log('[CATEGORY_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { categoryId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        // const cookieStore = cookies()
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        const body = await req.json();

        const { name } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!params.categoryId) {
            return new NextResponse('Category id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const category = await updateCategory(params.categoryId, body)

        return NextResponse.json(category, res);
    } catch (error) {
        console.log('[CATEGORY_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
