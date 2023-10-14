import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSession } from '@auth0/nextjs-auth0';
import { deleteUser, getUser, updateUser } from '@/lib/repositories/userRepository';
import axios from 'axios';

export async function PATCH(
    req: NextRequest,
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const loggedInUser = session?.user

        const body = await req.json();
        const { name, email } = body;

        if (!loggedInUser) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!email) {
            return new NextResponse('Email is required', { status: 400 });
        }

        // update user in auth0
        const r = await axios.post(`https://dev-cfptovsv0ozskcr0.us.auth0.com/oauth/token`, { client_id: process.env.AUTH0_CLIENT_ID, client_secret: process.env.AUTH0_CLIENT_SECRET, audience: "https://dev-cfptovsv0ozskcr0.us.auth0.com/api/v2/", grant_type: "client_credentials" })

        const { access_token } = r.data;

        const auth0Res = await axios.patch(`https://dev-cfptovsv0ozskcr0.us.auth0.com/api/v2/users/${loggedInUser.sub}`, {
            name,
            email
        }, {
            headers: {
                Authorization: `Bearer ${access_token}`
            }
        })

        const user = await updateUser(loggedInUser.sub, body)
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
        const session = await getSession(req, res);
        const loggedInUser = session?.loggedInUser

        if (!loggedInUser) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        const deletedUser = await deleteUser(loggedInUser.sub);
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
        const res = new NextResponse();
        const session = await getSession(req, res);
        const loggedInUser = session?.user

        if (!loggedInUser) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        const user = await getUser(loggedInUser.sub)
        return NextResponse.json(user);
    } catch (error) {
        console.log('[USER_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}