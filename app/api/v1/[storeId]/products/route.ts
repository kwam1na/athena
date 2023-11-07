import { NextRequest, NextResponse } from 'next/server';

import { createProduct, fetchProducts } from '@/lib/repositories/productsRepository';
import { findStore } from '@/lib/repositories/storesRepository';
import { generateSKU } from '@/app/api/utils';
import { createSKUCounter, getSKUCounter, updateSKUCounter } from '@/lib/repositories/skuCounterRepository';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function POST(
    req: NextRequest,
    { params }: { params: { storeId: string } },
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

        const body = await req.json();


        const {
            name,
            price,
            inventory_count,
            cost_per_item,
            category_id,
            subcategory_id,
            sku,
            images,
        } = body;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
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

        if (!inventory_count) {
            return new NextResponse('Inventory count is required', { status: 400 });
        }

        if (!cost_per_item) {
            return new NextResponse('Cost per item is required', { status: 400 });
        }

        if (!category_id) {
            return new NextResponse('Category id is required', { status: 400 });
        }

        if (!subcategory_id) {
            return new NextResponse('Subcategory id is required', { status: 400 });
        }

        // if (!colorId) {
        //     return new NextResponse('Color id is required', { status: 400 });
        // }

        // if (!sizeId) {
        //     return new NextResponse('Size id is required', { status: 400 });
        // }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        if (!body.organization_id) {
            return new NextResponse('Organization id is required', { status: 400 });
        }

        const storeId = parseInt(params.storeId)

        const storeByUserId = await findStore({
            id: storeId,
            created_by: user.id,
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 405 });
        }

        // const product = await prismadb.product.create({
        //     data: {
        //         name,
        //         price,
        //         costPerItem,
        //         isFeatured,
        //         isArchived,
        //         subcategoryId,
        //         count,
        //         categoryId,
        //         colorId,
        //         sizeId,
        //         storeId: storeId,
        //         images: {
        //             createMany: {
        //                 data: [
        //                     ...images.map((image: { url: string }) => image),
        //                 ],
        //             },
        //         },
        //     },
        // });
        if (!sku) {

            let skuCounter = await getSKUCounter(category_id, subcategory_id)
            if (!skuCounter) {
                skuCounter = await createSKUCounter({ category_id, subcategory_id })
            }
            body.sku = generateSKU(category_id, subcategory_id, skuCounter.last_used)
            await updateSKUCounter(skuCounter.id, { last_used: skuCounter.last_used + 1 })
        }

        const createParams = { ...body, store_id: storeId, organization_id: parseInt(body.organization_id) }
        const product = await createProduct(createParams)

        return NextResponse.json(product, res);
    } catch (error) {
        console.log('[PRODUCTS_POST]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}

export async function GET(
    req: Request,
    { params }: { params: { storeId: string } },
) {
    try {
        const { searchParams } = new URL(req.url);
        const category_id = searchParams.get('categoryId') || undefined;
        const color_id = searchParams.get('colorId') || undefined;
        const size_id = searchParams.get('sizeId') || undefined;
        const is_featured = searchParams.get('isFeatured');

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        const products = await fetchProducts({
            store_id: parseInt(params.storeId),
            category_id,
            color_id,
            size_id,
            is_featured: is_featured ? true : undefined,
            is_archived: false,
        });

        return NextResponse.json(products);
    } catch (error) {
        console.log('[PRODUCTS_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}
