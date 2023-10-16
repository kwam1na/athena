import prismadb from "@/lib/prismadb";
import { getSession } from "@auth0/nextjs-auth0";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
    req: NextRequest,
    { params }: { params: { storeId: string, transactionItemId: string } }
) {
    try {

        const res = new NextResponse();
        const session = await getSession(req, res);
        const user = session?.user


        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        const result = await prismadb.$transaction(async (prisma) => {
            // Retrieve transaction item
            const transactionItem = await prisma.transactionItem.findUnique({
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
            await prisma.transactionItem.delete({
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