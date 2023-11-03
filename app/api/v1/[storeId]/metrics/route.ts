import { getSalesRevenue } from "@/actions/get-sales-revenue";
import { getStockCount } from "@/actions/get-stock-count";
import { getTotalGrossRevenue } from "@/actions/get-total-gross-revenue";
import { getTotalNetRevenue } from "@/actions/get-total-net-revenue";
import { getTotalUnitsSoldForStore } from "@/actions/get-total-units";
import { getAverageTransactionValue, getAverageUnitsPerTransaction } from "@/actions/get-transactions-metrics";
import { createSupabaseServerClient } from "@/app/api/utils";
import { getSession } from "@auth0/nextjs-auth0";
// import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    try {
        const { searchParams } = new URL(req.url);
        const metric = searchParams.get('metric') || undefined;

        const res = new NextResponse();
        const supabase = createSupabaseServerClient();
        const {
            data: { session },
        } = await supabase.auth.getSession()

        const user = session?.user;

        if (!user) {
            return new NextResponse('Unauthenticated', { status: 403 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is required', { status: 400 });
        }

        if (!metric) {
            return new NextResponse('Metric is required', { status: 400 });
        }

        const storeId = parseInt(params.storeId)

        switch (metric) {

            case 'sales_revenue':
                const salesRevenue = await getSalesRevenue(storeId);
                return NextResponse.json({ data: { [metric]: salesRevenue } });

            case 'gross_revenue':
                const grossRevenue = await getTotalGrossRevenue(storeId);
                return NextResponse.json({ data: { [metric]: grossRevenue } });

            case 'net_revenue':
                const netRevenue = await getTotalNetRevenue(storeId);
                return NextResponse.json({ data: { [metric]: netRevenue } });

            case 'total_units_sold':
                const totalUnitsSold = await getTotalUnitsSoldForStore(storeId);
                return NextResponse.json({ data: { [metric]: totalUnitsSold } });

            case 'average_transaction_value':
                const averageTransactionValue = await getAverageTransactionValue(storeId);
                return NextResponse.json({ data: { [metric]: averageTransactionValue } });

            case 'average_units_per_transaction':
                const averageUnitsPerTransaction = await getAverageUnitsPerTransaction(storeId);
                return NextResponse.json({ data: { [metric]: averageUnitsPerTransaction } });

            case 'total_stock_count':
                const totalStockCount = await getStockCount(storeId);
                return NextResponse.json({ data: { [metric]: totalStockCount } });

            default:
                return new NextResponse('Invalid metric', { status: 400 });
        }
    } catch (error) {
        console.log('[METRICS_GET]', (error as Error).message);
        return new NextResponse('Internal error', { status: 500 });
    }
}