import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { deleteSize, getSize, updateSize } from '@/lib/repositories/sizesRepository';
import { findStore } from '@/lib/repositories/storesRepository';

export async function GET(
    req: Request,
    { params }: { params: { sizeId: string } },
) {
    try {
        if (!params.sizeId) {
            return new NextResponse('Size id is required', { status: 400 });
        }

        const size = await getSize(params.sizeId);

        return NextResponse.json(size);
    } catch (error) {
        console.log('[SIZE_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { sizeId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.sizeId) {
            return new NextResponse('Size id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            user_id: user.sub,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const size = await deleteSize(params.sizeId);

        return NextResponse.json(size);
    } catch (error) {
        console.log('[SIZE_DELETE]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { sizeId: string; storeId: string } },
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

        if (!params.sizeId) {
            return new NextResponse('Size id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            user_id: user.sub,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const size = await updateSize(params.sizeId, body);

        return NextResponse.json(size, res);
    } catch (error) {
        console.log('[SIZE_PATCH]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}
