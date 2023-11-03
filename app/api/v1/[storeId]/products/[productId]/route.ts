import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@auth0/nextjs-auth0';
import { deleteProduct, getProduct, updateProduct } from '@/lib/repositories/productsRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/app/api/utils';
import { parse } from 'path';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function GET(
    req: Request,
    { params }: { params: { productId: string } },
) {
    try {
        if (!params.productId) {
            return new NextResponse('Product id is required', { status: 400 });
        }

        const product = await getProduct(params.productId);
        return NextResponse.json(product);
    } catch (error) {
        console.log('[PRODUCT_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { productId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.productId) {
            return new NextResponse('Product id is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const product = await deleteProduct(params.productId);

        return NextResponse.json(product, res);
    } catch (error) {
        console.log('[PRODUCT_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { productId: string; storeId: string } },
) {
    try {
        const res = new NextResponse();
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        const body = await req.json();

        const {
            name,
            price,
            count,
            cost_per_item,
            category_id,
            subcategory_id,
            images,
        } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.productId) {
            return new NextResponse('Product id is required', { status: 400 });
        }

        // if (!name) {
        //     return new NextResponse('Name is required', { status: 400 });
        // }

        // if (!images || !images.length) {
        //     return new NextResponse('Images are required', { status: 400 });
        // }

        // if (!price) {
        //     return new NextResponse('Price is required', { status: 400 });
        // }

        // if (!cost_per_item) {
        //     return new NextResponse('Cost per item is required', { status: 400 });
        // }

        // if (!count) {
        //     return new NextResponse('Count is required', { status: 400 });
        // }

        // if (!category_id) {
        //     return new NextResponse('Category id is required', { status: 400 });
        // }

        // if (!subcategory_id) {
        //     return new NextResponse('Subcategory id is required', { status: 400 });
        // }

        const storeByUserId = await findStore({
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        // await prismadb.product.update({
        //     where: {
        //         id: params.productId,
        //     },
        //     data: {
        //         name,
        //         price,
        //         costPerItem,
        //         count,
        //         categoryId,
        //         subcategoryId,
        //         colorId,
        //         sizeId,
        //         images: {
        //             deleteMany: {},
        //         },
        //         isFeatured,
        //         isArchived,
        //     },
        // });

        // const product = await prismadb.product.update({
        //     where: {
        //         id: params.productId,
        //     },
        //     data: {
        //         images: {
        //             createMany: {
        //                 data: [
        //                     ...images.map((image: { url: string }) => image),
        //                 ],
        //             },
        //         },
        //     },
        // });
        const product = await updateProduct(params.productId, body)

        return NextResponse.json(product);
    } catch (error) {
        console.log('[PRODUCT_PATCH]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
