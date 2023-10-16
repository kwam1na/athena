import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { deleteSubcategory, getSubcategory, updateSubcategory } from '@/lib/repositories/subcategoriesRepository';
import { findStore } from '@/lib/repositories/storesRepository';

export async function GET(
    req: Request,
    { params }: { params: { subcategoryId: string } },
) {
    try {
        if (!params.subcategoryId) {
            return new NextResponse('Subcategory id is required', { status: 400 });
        }

        const subcategory = await getSubcategory(params.subcategoryId);
        return NextResponse.json(subcategory);
    } catch (error) {
        console.log('[SUBCATEGORY_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { subcategoryId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.subcategoryId) {
            return new NextResponse('Subcategory id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            user_id: user.sub,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const subcategory = await deleteSubcategory(params.subcategoryId);
        return NextResponse.json(subcategory, res);
    } catch (error) {
        console.log('[SUBCATEGORY_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { subcategoryId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user

        const body = await req.json();

        const { name, categoryId } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }


        if (!params.subcategoryId) {
            return new NextResponse('Subcategory id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: params.storeId,
            user_id: user.sub,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const subcategory = await updateSubcategory(params.subcategoryId, body);
        return NextResponse.json(subcategory, res);
    } catch (error) {
        console.log('[SUBCATEGORY_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
