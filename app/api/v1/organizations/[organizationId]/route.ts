import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { deleteOrganization, getOrganization, updateOrganization } from '@/lib/repositories/organizationsRepository';

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

        const user = session?.user;

        const body = await req.json();
        const { name, organization_id } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!organization_id) {
            return new NextResponse('Organization id is required', { status: 400 });
        }

        const organizationData = {
            name,
        }

        const organization = await updateOrganization(organization_id, organizationData)

        return NextResponse.json(organization, res);
    } catch (error) {
        console.log('[ORGANIZATION_PATCH]', (error as Error).message);
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

        const user = session?.user;

        const body = await req.json();

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!body.organization_id) {
            return new NextResponse('Organization id is required', { status: 400 });
        }

        const organization = await deleteOrganization(body.organization_id);
        return NextResponse.json(organization, res);
    } catch (error) {
        console.log('[ORGANIZATION_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(
    req: NextRequest,
    { params }: { params: { organizationId: string } },
) {
    try {
        if (!params.organizationId) {
            return new NextResponse('Organization id is required', { status: 400 });
        }

        const organization = await getOrganization(parseInt(params.organizationId))
        return NextResponse.json(organization);
    } catch (error) {
        console.log('[ORGANIZATION_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}
