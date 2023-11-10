import { keysToCamelCase } from "@/lib/utils";
import { AutoSavedTransaction, ReportEntryAction, TransactionItem, TransactionWithoutID } from "@/types/transactions";
import { format } from "date-fns";

/**
 * Checks if two arrays of AutoSavedTransaction objects are in sync.
 * @param a - First array of AutoSavedTransaction.
 * @param b - Second array of AutoSavedTransaction.
 * @returns - True if both arrays are in sync, false otherwise.
 */
export const autoSaveIsInSync = (
    a: AutoSavedTransaction[],
    b: AutoSavedTransaction[],
): boolean => {
    if (a.length !== b.length) return false;

    return a.every((aTrans, index) => {
        const bTrans = b[index];

        if (
            aTrans.id !== bTrans.id ||
            aTrans.transactionDate?.getTime() !==
            bTrans.transactionDate?.getTime()
        ) {
            return false;
        }

        if (aTrans.transactionItems.length !== bTrans.transactionItems.length)
            return false;

        return aTrans.transactionItems.every((aItem, itemIndex) => {
            const bItem = bTrans.transactionItems[itemIndex];
            return JSON.stringify(aItem) === JSON.stringify(bItem);
        });
    });
};


/**
 * Checks if two arrays of TransactionItem objects are in sync.
 *
 * @param a - First array of TransactionItem objects.
 * @param b - Second array of TransactionItem objects.
 * @returns boolean - True if both arrays are in sync, otherwise false.
 */
export const areTransactionItemsInSync = (
    a: TransactionItem[],
    b: TransactionItem[],
): boolean => {
    if (a.length !== b.length) return false;

    return a.every((aTrans, index) => {
        const bTrans = b[index];
        return JSON.stringify(aTrans) === JSON.stringify(bTrans);
    });
}

/**
 * Checks if two TransactionWithoutID objects are in sync.
 *
 * @param a - First TransactionWithoutID object.
 * @param b - Second TransactionWithoutID object.
 * @returns boolean - True if both objects are in sync, otherwise false.
 */
export const areSingleTransactionsInSync = (
    a: TransactionWithoutID,
    b: TransactionWithoutID,
): boolean => {
    return JSON.stringify(a) === JSON.stringify(b);
};


/**
 * Gets the title for an autosaved report.
 * @param id - ID of the report.
 * @param reportDate - Optional date for the report.
 * @returns - The formatted title.
 */
export const getAutosavedReportTitle = (id: string, reportDate?: Date) => {
    return `${format(
        reportDate ? new Date(reportDate) : new Date(),
        'MMM_d_yyyy',
    )}_${id.split('-')[1]}`;
};

/**
 * Calculates the total sales from an array of TransactionItems.
 * @param items - Array of TransactionItem objects
 * @returns Total sales amount
 */
export const getTotalSales = (items: TransactionItem[]): number => {
    return items.reduce((total, item) => total + (parseFloat(item.price || '0') * (item.unitsSold || 0)), 0);
};


/**
 * Calculates the net revenue from an array of TransactionItems.
 * @param items - Array of TransactionItem objects
 * @returns Net revenue amount
 */
export const getNetRevenue = (items: TransactionItem[]): number => {
    const totalSales = getTotalSales(items);
    const totalCost = items.reduce((total, item) => total + (parseFloat(item.cost || '0') * (item.unitsSold || 0)), 0);
    return totalSales - totalCost
};

/**
 * Calculates the total units sold from an array of TransactionItems.
 * @param items - Array of TransactionItem objects
 * @returns Total units sold
 */
export const getTotalUnitsSold = (items: TransactionItem[]): number => {
    return items.reduce((total, item) => total + (item.unitsSold || 0), 0);
};

/**
 * Calculates sales amount per product from an array of TransactionItems.
 * @param items - Array of TransactionItem objects
 * @returns An object where keys are product names and values are total sales for that product
 */
export const getProductSales = (items: TransactionItem[]): Record<string, number> => {
    const productSales: Record<string, number> = {};
    items.forEach(item => {
        const name = item.productName || 'Unknown';
        productSales[name] = (productSales[name] || 0) + (parseFloat(item.price || '0') * (item.unitsSold || 0));
    });
    return productSales;
};

/**
 * Calculates sales amount and units sold per category from an array of TransactionItems.
 * @param items - Array of TransactionItem objects
 * @returns An object where keys are category IDs and values are total sales for that category
 */
export const getCategorySalesAndUnits = (items: TransactionItem[]): Record<string, { totalSales: number, unitsSold: number }> => {
    const categoryData: Record<string, { totalSales: number, unitsSold: number }> = {};

    items.forEach(item => {
        const category = item.category || 'Unknown';

        if (!categoryData[category]) {
            categoryData[category] = { totalSales: 0, unitsSold: 0 };
        }

        const price = parseFloat(item.price || '0');
        const units = item.unitsSold || 0;

        categoryData[category].totalSales += price * units;
        categoryData[category].unitsSold += units;
    });

    return categoryData;
};



