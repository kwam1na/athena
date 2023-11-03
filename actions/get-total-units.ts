import { fetchTransactions } from '@/lib/repositories/transactionsRepository';

export const getTotalUnitsSoldForStore = async (storeId: number) => {
    const publishedReports = await fetchTransactions({
        store_id: storeId,
        status: 'published',
    });

    const totalUnitsSold = publishedReports.reduce((total, report) => {
        return total + (report.units_sold || 0);
    }, 0);

    return totalUnitsSold;
};
