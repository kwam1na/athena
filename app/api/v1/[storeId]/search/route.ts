import { fetchProducts } from "@/lib/repositories/productsRepository";
import { getSession } from "@auth0/nextjs-auth0";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const res = new NextResponse();
        const session = await getSession(req, res);
        const loggedInUser = session?.user

        const { searchParams } = new URL(req.url);
        const query = searchParams.get('query')

        if (!loggedInUser) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        // would like to be able to search by either sku or product name
        const product = await fetchProducts({
            store_id: params.storeId,
            sku: query,
            product_name: query,
        })
        return NextResponse.json(product);
    } catch (error) {
        console.log('[USER_GET]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}