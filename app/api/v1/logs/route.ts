import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextRequest, NextResponse } from "next/server";
import logger from "@/lib/logger/pino-logger";

export async function POST(
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

        const user = session?.user;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        const { level, data, message } = await req.json();

        switch (level) {
            case 'info':
                logger.info(message, data)
                break;

            case 'warn':
                logger.warn(message, data)
                break;

            case 'error':
                logger.error(message, data)
                break;

            case 'debug':
                logger.debug(message, data)
                break;

            default:
                return new NextResponse('Invalid log level', { status: 400 });
        }


        return new NextResponse('Log received', { status: 200 });
    } catch (error) {
        console.log('[LOGS_POST]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}