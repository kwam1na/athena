import { NextRequest, NextResponse } from 'next/server';
import { deleteColor, getColor, updateColor } from '@/lib/repositories/colorsRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function GET(
    req: Request,
    { params }: { params: { colorId: string } },
) {
    try {
        if (!params.colorId) {
            return new NextResponse('Color id is required', { status: 400 });
        }

        const color = await getColor(params.colorId);

        return NextResponse.json(color);
    } catch (error) {
        console.log('[COLOR_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { colorId: string; storeId: string } },
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

        if (!params.colorId) {
            return new NextResponse('Color id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const color = await deleteColor(params.colorId);

        return NextResponse.json(color, res);
    } catch (error) {
        console.log('[COLOR_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { colorId: string; storeId: string } },
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

        if (!params.colorId) {
            return new NextResponse('Color id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const color = await updateColor(params.colorId, body);

        return NextResponse.json(color, res);
    } catch (error) {
        console.log('[COLOR_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
