import { NextRequest, NextResponse } from 'next/server';

import { deleteCategory, getCategory, updateCategory } from '@/lib/repositories/categoriesRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

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
        const cookieStore = cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value;
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        cookieStore.set({ name, value, ...options });
                    },
                    remove(name: string, options: CookieOptions) {
                        cookieStore.set({ name, value: '', ...options });
                    },
                },
            },
        );

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
            id: parseInt(params.storeId),
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
        const cookieStore = cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value;
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        cookieStore.set({ name, value, ...options });
                    },
                    remove(name: string, options: CookieOptions) {
                        cookieStore.set({ name, value: '', ...options });
                    },
                },
            },
        );
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
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized to perform this action for this store', { status: 405 });
        }

        const category = await updateCategory(params.categoryId, body)

        return NextResponse.json(category, res);
    } catch (error) {
        console.log('[CATEGORY_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
