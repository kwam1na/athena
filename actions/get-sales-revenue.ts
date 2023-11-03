import prismadb from '@/lib/prismadb';
import { fetchTransactions } from '@/lib/repositories/transactionsRepository';

export interface GraphData {
    month: string;
    grossRevenue: number;
    netRevenue: number;
}
// sample data, replace this with data processed from the database
const data = [
    { month: 'April', grossRevenue: 5600, netRevenue: 4600 },
    { month: 'June', grossRevenue: 4000, netRevenue: 1000 },
    { month: 'July', grossRevenue: 3400, netRevenue: 3300 },
    { month: 'August', grossRevenue: 9800, netRevenue: 5400 },
    { month: 'September', grossRevenue: 1100, netRevenue: 600 },
    { month: 'October', grossRevenue: 8000, netRevenue: 6700 },
];


export const getSalesRevenue = async (storeId: number): Promise<GraphData[]> => {
    const currentDate = new Date();
    const startOfYear = new Date(currentDate.getFullYear(), 0, 1);

    // Fetch transactions for the current year
    const transactions = await fetchTransactions({ store_id: storeId, dateRange: { start: startOfYear, end: currentDate } });

    // Create an empty object to store revenue data by month
    const monthlyData: Record<string, { grossRevenue: number, netRevenue: number, monthNumber: number }> = {};

    // Process each transaction
    transactions.forEach(transaction => {
        const monthName = transaction.transaction_date.toLocaleString('default', { month: 'long' });
        const monthNumber = transaction.transaction_date.getMonth();

        if (!monthlyData[monthName]) {
            monthlyData[monthName] = { grossRevenue: 0, netRevenue: 0, monthNumber };
        }

        // Assuming transaction has fields `grossAmount` and `netAmount`
        monthlyData[monthName].grossRevenue += transaction.gross_sales || 0;
        monthlyData[monthName].netRevenue += transaction.net_revenue || 0;
    });

    // Convert the monthlyData object into an array of GraphData
    const graphData: GraphData[] = Object.keys(monthlyData).map(month => ({
        month,
        grossRevenue: monthlyData[month].grossRevenue,
        netRevenue: monthlyData[month].netRevenue,
    }));

    // Sort the data by month number
    graphData.sort((a, b) => monthlyData[a.month].monthNumber - monthlyData[b.month].monthNumber);

    return graphData;
};


