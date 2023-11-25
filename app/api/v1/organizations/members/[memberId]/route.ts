import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prismadb';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { revalidatePath } from 'next/cache';

export async function DELETE(req: NextRequest, { params }: { params: { memberId: string } },) {
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
            return new NextResponse('Unauthorized', { status: 403 });
        }

        // Delete the organization member
        const deletedMember = await prismadb.organization_member.delete({
            where: {
                id: parseInt(params.memberId),
            },
        });

        // revalidatePath(`/organizations/${deletedMember.organization_id}`);

        return NextResponse.json(deletedMember, res);
    } catch (error) {
        console.log('[ORGANIZATION_MEMBER_DELETE]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}