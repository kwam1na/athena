import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prismadb';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createOrganization } from '@/lib/repositories/organizationsRepository';

export async function POST(req: NextRequest) {
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
            return new NextResponse('Unauthorized', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        const createParams = { ...body, created_by: user.id }
        const organization = await createOrganization(createParams);

        await prismadb.user.update({
            where: {
                id: user.id,
            },
            data: {
                organization_id: organization.id,
            }
        })

        await prismadb.organization_member.create({
            data: {
                organization_id: organization.id,
                user_id: user.id,
                role: 'owner',
            },
        });

        return NextResponse.json(organization, res);
    } catch (error) {
        console.log('[ORGANIZATIONS_POST]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}




