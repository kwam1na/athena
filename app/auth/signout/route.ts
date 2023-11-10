import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
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

    // Sign out logic
    const { error } = await supabase.auth.signOut();

    if (error) {
        console.error('Error during sign out:', error);
        return new NextResponse('Sign out failed', { status: 500 });
    }

    // Create response object to redirect user and clear cookies.
    const response = NextResponse.redirect(new URL('/auth', req.url));

    // Invalidate cookies by setting them to expire immediately.
    response.cookies.delete('access_token');
    response.cookies.delete('refresh_token');

    return response;
}