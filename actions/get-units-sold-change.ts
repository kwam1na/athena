import { fetchTransactions } from "@/lib/repositories/transactionsRepository";
import { transaction } from "@prisma/client";

export const getTotalUnitsSoldChange = async (storeId: number) => {
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

    const currentWeekTotalUnitsSold = calculateTotalUnitsSoldFromReports(currentWeekData);
    const previousWeekTotalUnitsSold = calculateTotalUnitsSoldFromReports(previousWeekData);


    const percentageChange = ((currentWeekTotalUnitsSold - previousWeekTotalUnitsSold) / previousWeekTotalUnitsSold) * 100;

    return percentageChange === Infinity || isNaN(percentageChange) ? 0 : percentageChange;
};

const calculateTotalUnitsSoldFromReports = (reports: transaction[]) => {
    return reports.reduce((total, report) => {
        return total + (report.units_sold || 0);
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