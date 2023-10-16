import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { createSize, fetchSizes } from '@/lib/repositories/sizesRepository';
import { findStore } from '@/lib/repositories/storesRepository';

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();

        const { name, value } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!value) {
            return new NextResponse('Value is required', { status: 400 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            user_id: user.sub,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const createParams = { ...body, store_id: params.storeId }
        const size = await createSize(createParams);

        return NextResponse.json(size, res);
    } catch (error) {
        console.log('[SIZES_POST]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(
    req: Request,
    { params }: { params: { storeId: string } },
) {
    try {
        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const sizes = await fetchSizes(params.storeId);

        return NextResponse.json(sizes);
    } catch (error) {
        console.log('[SIZES_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}
