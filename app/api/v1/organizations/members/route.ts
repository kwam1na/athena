import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prismadb';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'

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

        const { email, role, organization_id } = body;

        if (!user) {
            return new NextResponse('Unauthorized', { status: 403 });
        }

        if (!email) {
            return new NextResponse('Email is required', { status: 400 });
        }

        if (!role) {
            return new NextResponse('Role is required', { status: 400 });
        }

        if (!organization_id) {
            return new NextResponse('Organization Id is required', { status: 400 });
        }

        // Create the organization member and update the organization
        const organizationMember = await prismadb.organization.update({
            where: {
                id: organization_id,
            },
            data: {
                members: {
                    create: {
                        role,
                        user_email: email,
                    },
                },
            },
            include: {
                members: true,
            },
        });

        return NextResponse.json(organizationMember, res);
    } catch (error) {
        console.log('[ORGANIZATION_MEMBER_POST]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(req: NextRequest) {
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

        const { searchParams } = new URL(req.url);
        const email = searchParams.get('email');

        if (!email) {
            return new NextResponse('Email is required', { status: 400 });
        }

        const memberWithOrganization = await prismadb.organization_member.findUnique({
            where: {
                user_email: email,
            },
            include: {
                organization: {
                    select: {
                        name: true,
                    }
                }
            }
        });

        if (memberWithOrganization) {
            return NextResponse.json({
                exists: true,
                // @ts-ignore
                organization_name: memberWithOrganization.organization?.name,
                organization_id: memberWithOrganization.organization_id,
            }, res);
        } else {
            return NextResponse.json({ exists: false }, res);
        }

    } catch (error) {
        console.log('[ORGANIZATION_MEMBER_POST]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        // Set up response and supabase client
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

        // Parse request body
        const { email, is_onboarded, user_id } = await req.json();
        if (!email) {
            return new NextResponse('Email is required', { status: 400 });
        }

        if (!user_id) {
            return new NextResponse('User ID is required', { status: 400 });
        }

        if (typeof is_onboarded !== 'boolean') {
            return new NextResponse('isOnboarded must be a boolean', { status: 400 });
        }

        // Find the member by email
        const member = await prismadb.organization_member.findUnique({
            where: { user_email: email },
        });

        // If member doesn't exist, return an error
        if (!member) {
            return NextResponse.json({ exists: false }, res);
        }

        // Update the is_onboarded property
        const updatedMember = await prismadb.organization_member.update({
            where: { id: member.id },
            data: { is_onboarded, user_id },
        });

        // Return the updated member data
        return NextResponse.json(updatedMember, res);

    } catch (error) {
        console.log('[ORGANIZATION_MEMBER_PATCH]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}






