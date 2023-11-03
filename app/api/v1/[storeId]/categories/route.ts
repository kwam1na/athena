import { NextRequest, NextResponse } from 'next/server';

import { createCategory, fetchCategories } from '@/lib/repositories/categoriesRepository';
import { findStore } from '@/lib/repositories/storesRepository';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        // const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
        const cookieStore = cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        cookieStore.set({ name, value, ...options })
                    },
                    remove(name: string, options: CookieOptions) {
                        cookieStore.set({ name, value: '', ...options })
                    },
                },
            }
        )

        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        const body = await req.json();

        const { name, billboardId } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
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
        const category = await createCategory(createParams);

        return NextResponse.json(category);
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

        const categories = await fetchCategories(params.storeId)
        return NextResponse.json(categories);
    } catch (error) {
        console.log('[CATEGORIES_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}
