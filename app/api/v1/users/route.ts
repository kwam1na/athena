import { NextRequest, NextResponse } from 'next/server';
import { deleteUser, getUser, updateUser } from '@/lib/repositories/userRepository';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function PATCH(
    req: NextRequest,
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

        const loggedInUser = session?.user;

        console.log('loggedInUser...', loggedInUser)

        const body = await req.json();

        if (!loggedInUser) {
            return NextResponse.json({
                message: 'Unauthenticated'
            }, { status: 401 })
        }

        if (Object.keys(body).length === 0) {
            return new NextResponse('Empty body received', { status: 400 });
        }


        const user = await updateUser(loggedInUser.id, body)
        return NextResponse.json(user, res);
    } catch (error) {
        console.log('[USER_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
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

        const loggedInUser = session?.user;

        if (!loggedInUser) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        const deletedUser = await deleteUser(loggedInUser.id);
        return NextResponse.json(deletedUser, res);
    } catch (error) {
        console.log('[USER_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(
    req: NextRequest,
) {
    try {
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

        const loggedInUser = session?.user;

        if (!loggedInUser) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        const user = await getUser(loggedInUser.id)
        return NextResponse.json(user);
    } catch (error) {
        console.log('[USER_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}