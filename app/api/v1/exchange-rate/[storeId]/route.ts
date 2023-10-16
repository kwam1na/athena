import { getStore } from '@/lib/repositories/storesRepository';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
    req: NextRequest,
    { params }: { params: { storeId: string } },
) {
    const res = new NextResponse();
    const store = await getStore(params.storeId)
    const currency = store?.currency.toUpperCase()

    try {
        const response = await axios.get(
            `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/latest/USD`
        );

        if (!currency) {
            return new NextResponse('Currency is required', { status: 400 });
        }


        let rate;
        if (response.data && typeof response.data.conversion_rates === 'object' && currency as string in response.data.conversion_rates) {
            rate = response.data.conversion_rates[currency as keyof typeof response.data.conversion_rates];
        }
        if (rate) {
            return NextResponse.json({ rate }, res);
        } else {
            return new NextResponse('Currency not found', { status: 404 });
        }
    } catch (error) {
        console.log('[EXCHANGE_RATE_API_ERROR] error:', (error as Error).message)
        return new NextResponse('Failed to fetch exchange rate', { status: 500 });
    }
}