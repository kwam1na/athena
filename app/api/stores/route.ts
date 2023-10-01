import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prismadb';
import { handleError } from '../utils';
import { withApiAuthRequired, getSession } from '@auth0/nextjs-auth0';
import { createStore, getStore } from '@/lib/repositories/storesRepository';

const handler = withApiAuthRequired(async function POST(req: NextRequest) {
    try {

        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();

        const { name, currency } = body;

        if (!user) {
            return new NextResponse('Unauthorized', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!currency) {
            return new NextResponse('Currency is required', { status: 400 });
        }

        const createParams = { ...body, user_id: user.sub }
        const store = await createStore(createParams);

        await prismadb.user.update({
            where: {
                id: user.sub,
            },
            data: {
                store_id: store.id,
            }
        })

        return NextResponse.json(store, res);
    } catch (error) {
        console.log('[STORES_POST]', error);
        return handleError(error)
    }
});

export { handler as POST }




