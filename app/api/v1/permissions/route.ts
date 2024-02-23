import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { getUser } from "@/lib/repositories/userRepository";

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