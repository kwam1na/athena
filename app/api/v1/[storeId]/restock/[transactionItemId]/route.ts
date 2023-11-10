import prismadb from "@/lib/prismadb";
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
    req: NextRequest,
    { params }: { params: { storeId: string, transactionItemId: string } }
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

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        const result = await prismadb.$transaction(async (prisma) => {
            // Retrieve transaction item
            const transactionItem = await prisma.transaction_item.findUnique({
                where: { id: params.transactionItemId },
            });
            if (!transactionItem) {
                return { status: 'item_not_found' };
            }

            // Retrieve related product
            const product = await prisma.product.findUnique({
                where: { id: transactionItem.product_id },
            });
            if (!product) {
                return { status: 'product_not_found' };
            }

            // Update inventory
            await prisma.product.update({
                where: { id: product.id },
                data: { inventory_count: { increment: transactionItem.units_sold } },
            });

            // Delete transaction item
            await prisma.transaction_item.delete({
                where: { id: params.transactionItemId },
            });

            return { status: 'success' };
        });

        if (result.status !== 'success') {
            return new NextResponse('Operation failed', { status: 400 });
        }

        return new NextResponse('Operation succeeded', { status: 200 });

    } catch (error) {
        return new NextResponse('Internal error', { status: 500 });
    }
}