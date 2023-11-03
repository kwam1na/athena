import { NextRequest, NextResponse } from 'next/server';
import { deleteUser, getUser, updateUser } from '@/lib/repositories/userRepository';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/app/api/utils';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function PATCH(
    req: NextRequest,
) {
    try {
        const res = new NextResponse();

        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const loggedInUser = session?.user;

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
        const supabase = createSupabaseServerClient();
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
        const supabase = createSupabaseServerClient();
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