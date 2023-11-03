import { fetchProducts } from "@/lib/repositories/productsRepository";
import { getSession } from "@auth0/nextjs-auth0";
// import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        // const cookieStore = cookies()
        // const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
        // const {
        //     data: { session },
        // } = await supabase.auth.getSession()

        // const loggedInUser = session?.user;

        const { searchParams } = new URL(req.url);
        const query = searchParams.get('query')

        // if (!loggedInUser) {
        //     return new NextResponse('Unauthenticated', { status: 403 });
        // }

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