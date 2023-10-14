import { NextRequest, NextResponse } from 'next/server';

import prismadb from '@/lib/prismadb';
import { getSession } from '@auth0/nextjs-auth0';

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();

        const { label, image_url } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!label) {
            return new NextResponse('Label is required', { status: 400 });
        }

        if (!image_url) {
            return new NextResponse('Image URL is required', { status: 400 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const storeByUserId = await prismadb.store.findFirst({
            where: {
                id: params.storeId,
                user_id: user.sub,
            },
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const billboard = await prismadb.billboard.create({
            data: {
                label,
                image_url,
                store_id: params.storeId,
            },
        });

        return NextResponse.json(billboard, res);
    } catch (error) {
        console.log('[BILLBOARDS_POST]', error);
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

        const billboards = await prismadb.billboard.findMany({
            where: {
                store_id: params.storeId,
            },
        });

        return NextResponse.json(billboards);
    } catch (error) {
        console.log('[BILLBOARDS_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}
