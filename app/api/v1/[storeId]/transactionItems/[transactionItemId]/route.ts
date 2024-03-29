import { NextRequest, NextResponse } from 'next/server';

import { updateProduct } from '@/lib/repositories/productsRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { deleteTransactionItem, getTransactionItem } from '@/lib/repositories/transactionItemsRepository';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function GET(
    req: NextRequest,
    { params }: { params: { transactionItemId: string; storeId: string } },
) {
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
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.transactionItemId) {
            return new NextResponse('TransactionItemId is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const transactionItem = await getTransactionItem(params.transactionItemId)
        return NextResponse.json(transactionItem, res);
    } catch (error) {
        console.log('[PRODUCT_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { transactionItemId: string; storeId: string } },
) {
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
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.transactionItemId) {
            return new NextResponse('TransactionItemId is required', { status: 400 });
        }

        const storeByUserId = await findStore({
            id: parseInt(params.storeId),
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        const transactionItem = await deleteTransactionItem(params.transactionItemId);

        return NextResponse.json(transactionItem, res);
    } catch (error) {
        console.log('[TRANSACTION_ITEM_DELETE]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { productId: string; storeId: string } },
) {
    try {
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

        if (!name) {
            return new NextResponse('Name is required', { status: 400 });
        }

        // if (!images || !images.length) {
        //     return new NextResponse('Images are required', { status: 400 });
        // }

        if (!price) {
            return new NextResponse('Price is required', { status: 400 });
        }

        if (!cost_per_item) {
            return new NextResponse('Cost per item is required', { status: 400 });
        }

        if (!count) {
            return new NextResponse('Count is required', { status: 400 });
        }

        if (!category_id) {
            return new NextResponse('Category id is required', { status: 400 });
        }

        if (!subcategory_id) {
            return new NextResponse('Subcategory id is required', { status: 400 });
        }

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
