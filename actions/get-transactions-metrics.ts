import { fetchTransactions } from "@/lib/repositories/transactionsRepository";
import { getTotalGrossRevenue } from "./get-total-gross-revenue";
import { getTotalUnitsSoldForStore } from "./get-total-units";

export const getAverageTransactionValue = async (storeId: string) => {
    const totalRevenue = await getTotalGrossRevenue(storeId);
    const publishedReports = await fetchTransactions({ store_id: storeId, status: 'published' });
    return totalRevenue / publishedReports.length;
};

export const getTotalTransactionReports = async (storeId: string) => {
    const publishedReports = await fetchTransactions({ store_id: storeId, status: 'published' });
    return publishedReports.length;
};

export const getAverageUnitsPerTransaction = async (storeId: string) => {
    const totalUnits = await getTotalUnitsSoldForStore(storeId);
    const publishedReports = await fetchTransactions({ store_id: storeId, status: 'published' });
    return totalUnits / publishedReports.length;
};

export const getCategoryWiseMetrics = async (storeId: string) => {
    const transactions = await fetchTransactions({ store_id: storeId, status: 'published' });

    const categoryMetrics: Record<string, { revenue: number, units_sold: number }> = {};

    transactions.forEach(transaction => {
        transaction.transaction_items.forEach(item => {
            const revenueForItem = item.price * item.units_sold;
            if (categoryMetrics[item.category]) {
                categoryMetrics[item.category].revenue += revenueForItem;
                categoryMetrics[item.category].units_sold += item.units_sold;
            } else {
                categoryMetrics[item.category] = { revenue: revenueForItem, units_sold: item.units_sold };
            }
        });
    });

    return categoryMetrics;
};

export const getTopProductsForMonth = async (storeId: string, month: number, year: number, n: number) => {
    // Start and end dates for the specified month
    const startDate = new Date(year, month - 1, 1); // months are 0-indexed
    const endDate = new Date(year, month, 0); // 0 gives the last day of the previous month

    // Fetch transactions for the given month
    const transactions = await fetchTransactions({ store_id: storeId, status: 'published', dateRange: { start: startDate, end: endDate } });

    const productMetrics: Record<string, { revenue: number, units_sold: number, product_name: string }> = {};

    transactions.forEach(transaction => {
        transaction.transaction_items.forEach(item => {
            const revenueForItem = item.price * item.units_sold;
            if (productMetrics[item.product_id]) {
                productMetrics[item.product_id].revenue += revenueForItem;
                productMetrics[item.product_id].units_sold += item.units_sold;
                productMetrics[item.product_id].product_name = item.product_name;
            } else {
                productMetrics[item.product_id] = { revenue: revenueForItem, units_sold: item.units_sold, product_name: item.product_name };
            }
        });
    });

    // Convert the object to an array, sort it by units sold, and get the top n
    const sortedProducts = Object.entries(productMetrics)
        .sort(([, aVal], [, bVal]) => bVal.units_sold - aVal.units_sold)
        .slice(0, n);

    return sortedProducts;
};