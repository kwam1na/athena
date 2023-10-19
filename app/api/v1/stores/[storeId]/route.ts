import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { deleteStore, getStore, updateStore } from '@/lib/repositories/storesRepository';

export async function PATCH(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {

        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();
        const { name, currency } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        if (!currency) {
            return new NextResponse('Currency is required', { status: 400 });
        }

        if (!body.low_stock_threshold) {
            return new NextResponse('Low stock threshold is required', { status: 400 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const storeData = {
            name,
            currency,
            settings: {
                low_stock_threshold: body.low_stock_threshold,
            }
        }

        const store = await updateStore(params.storeId, user.sub, storeData)

        return NextResponse.json(store, res);
    } catch (error) {
        console.log('[STORE_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const store = await deleteStore(params.storeId, user.sub);
        return NextResponse.json(store, res);
    } catch (error) {
        console.log('[STORE_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const store = await getStore(params.storeId)
        return NextResponse.json(store);
    } catch (error) {
        console.log('[STORES_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}
