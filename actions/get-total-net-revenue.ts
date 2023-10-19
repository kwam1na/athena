import { fetchTransactions } from '@/lib/repositories/transactionsRepository';

export const getTotalNetRevenue = async (storeId: string) => {
    const publishedReports = await fetchTransactions({
        store_id: storeId,
        status: 'published',
    });

    const totalNetRevenue = publishedReports.reduce((total, report) => {
        return total + (report.net_revenue || 0);
    }, 0);

    return totalNetRevenue;
};
