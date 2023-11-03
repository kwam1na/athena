import { fetchTransactions } from "@/lib/repositories/transactionsRepository";
import { transaction } from "@prisma/client";

export const getRevenueChange = async (storeId: number, type: 'gross' | 'net') => {
    const currentWeekData = await fetchTransactions({
        store_id: storeId,
        status: 'published',
        dateRange: getCurrentWeekRange(),
    });

    const previousWeekData = await fetchTransactions({
        store_id: storeId,
        status: 'published',
        dateRange: getPreviousWeekRange(),
    });

    let currentWeekRevenue, previousWeekRevenue;

    if (type === 'gross') {
        currentWeekRevenue = calculateGrossRevenueFromReports(currentWeekData);
        previousWeekRevenue = calculateGrossRevenueFromReports(previousWeekData);
    } else {
        currentWeekRevenue = calculateNetRevenueFromReports(currentWeekData);
        previousWeekRevenue = calculateNetRevenueFromReports(previousWeekData);
    }

    const percentageChange = ((currentWeekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100;

    return percentageChange === Infinity || isNaN(percentageChange) ? 0 : percentageChange;
};

const calculateGrossRevenueFromReports = (reports: transaction[]) => {
    return reports.reduce((total, report) => {
        return total + (report.gross_sales || 0);
    }, 0);
};

const calculateNetRevenueFromReports = (reports: transaction[]) => {
    return reports.reduce((total, report) => {
        return total + (report.net_revenue || 0);
    }, 0);
};

const getCurrentWeekRange = () => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (6 - now.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);

    return { start: startOfWeek, end: endOfWeek };
};

const getPreviousWeekRange = () => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() - 7);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (6 - now.getDay() - 7));
    endOfWeek.setHours(23, 59, 59, 999);

    return { start: startOfWeek, end: endOfWeek };
};