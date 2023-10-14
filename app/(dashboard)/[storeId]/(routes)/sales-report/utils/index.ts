import { keysToCamelCase } from "@/lib/utils";
import { AutoSavedTransaction, ReportEntryAction, TransactionItem, TransactionWithoutID } from "../components/client";
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
 * Fetches autosaved transactions for a given store ID.
 * @param storeId - ID of the store.
 * @returns - An array of AutoSavedTransaction objects.
 */
export const getAutoSavedTransactions = (storeId: string, entryAction: ReportEntryAction) => {
    const draftTransactions = getLocallySavedTransactions(storeId, entryAction);
    let transactions: AutoSavedTransaction[] = [];

    if (Object.keys(draftTransactions).length > 0) {
        transactions = Object.keys(draftTransactions).map((transactionId) => {
            let transactionDate: Date | undefined,
                reportTitle: string | undefined;
            const transactionItems = draftTransactions[transactionId];
            const items = Object.keys(transactionItems).map((key) => {
                if (!transactionDate) {
                    transactionDate = new Date(
                        transactionItems[key].transaction_date,
                    );
                }

                if (!reportTitle) {
                    reportTitle = transactionItems[key].transaction_report_title;
                }
                return keysToCamelCase(transactionItems[key]);
            });
            return {
                id: transactionId,
                reportTitle,
                transactionItems: items,
                transactionDate,
            };
        });
    }

    return transactions;
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
 * Generates a local storage key for draft transactions using a store ID.
 * @param storeId - ID of the store.
 * @returns - The generated key.
 */
export const getDraftsLocalStorageKey = (storeId: string) => {
    return `transactions-${storeId}`;
};

/**
 * Generates a local storage key for transactions being edited using a store ID.
 * @param storeId - ID of the store.
 * @returns - The generated key.
 */
export const getEditsLocalStorageKey = (storeId: string) => {
    return `transactions-editing-${storeId}`;
};

/**
 * Fetches draft transactions for a given store ID.
 * @param storeId - ID of the store.
 * @returns - Object containing draft transactions.
 */
export const getLocallySavedTransactions = (storeId: string, entryAction: ReportEntryAction): Record<string, any> => {
    const key = entryAction == 'new' ? getDraftsLocalStorageKey(storeId) : getEditsLocalStorageKey(storeId);
    return JSON.parse(localStorage.getItem(key) || '{}');
};

/**
 * Fetches a specific draft transaction.
 * @param storeId - ID of the store.
 * @param transactionId - ID of the transaction.
 * @returns - Object containing the draft transaction.
 */
export const getLocallySavedTransaction = (storeId: string, entryAction: ReportEntryAction, transactionId: string): Record<string, any> => {
    const transactions = getLocallySavedTransactions(storeId, entryAction)
    return transactions[transactionId]
}

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


/**
 * Removes a specific draft transaction from local storage.
 * @param storeId - ID of the store.
 * @param transactionId - ID of the transaction.
 */
export const removeLocallySavedTransaction = (storeId: string, entryAction: ReportEntryAction, transactionId: string) => {
    const key = entryAction == 'new' ? getDraftsLocalStorageKey(storeId) : getEditsLocalStorageKey(storeId);
    const draftTransactions = getLocallySavedTransactions(storeId, entryAction);
    delete draftTransactions[transactionId];
    saveItemInLocalStorage(key, draftTransactions);
};

/**
 * Saves an item in local storage.
 * @param key - The local storage key.
 * @param data - Data to be saved.
 */
export const saveItemInLocalStorage = (key: string, data: Record<string, any>) => {
    localStorage.setItem(key, JSON.stringify(data))
}

/**
 * Updates draft transactions in local storage.
 * @param storeId - ID of the store.
 * @param transactionId - ID of the transaction.
 * @param updatedTransaction - The updated transaction data.
 */
export const updateLocallySavedTransaction = (storeId: string, entryAction: ReportEntryAction, transactionId: string, updatedTransaction: Record<string, any>) => {
    const transactions = getLocallySavedTransactions(storeId, entryAction)
    transactions[transactionId] = updatedTransaction
    const key = entryAction == 'new' ? getDraftsLocalStorageKey(storeId) : getEditsLocalStorageKey(storeId);
    localStorage.setItem(key, JSON.stringify(transactions))
}






