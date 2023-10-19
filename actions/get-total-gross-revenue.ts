import { fetchTransactions } from '@/lib/repositories/transactionsRepository';

export const getTotalGrossRevenue = async (storeId: string) => {
    const publishedReports = await fetchTransactions({
        store_id: storeId,
        status: 'published',
    });

    const totalRevenue = publishedReports.reduce((total, report) => {
        return total + (report.gross_sales || 0);
    }, 0);

    return totalRevenue;
};
