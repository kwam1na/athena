import { keysToCamelCase } from "@/lib/utils";
import { AutoSavedTransaction } from "../components/client";
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
 * Fetches autosaved transactions for a given store ID.
 * @param storeId - ID of the store.
 * @returns - An array of AutoSavedTransaction objects.
 */
export const getAutoSavedTransactions = (storeId: string) => {
    const draftTransactions = getDraftTransactions(storeId);
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
 * Generates a local storage key for transactions using a store ID.
 * @param storeId - ID of the store.
 * @returns - The generated key.
 */
export const getLocalStorageKey = (storeId: string) => {
    return `transactions-${storeId}`;
};

/**
 * Fetches draft transactions for a given store ID.
 * @param storeId - ID of the store.
 * @returns - Object containing draft transactions.
 */
export const getDraftTransactions = (storeId: string): Record<string, any> => {
    const key = getLocalStorageKey(storeId);
    return JSON.parse(localStorage.getItem(key) || '{}');
};

/**
 * Fetches a specific draft transaction.
 * @param storeId - ID of the store.
 * @param transactionId - ID of the transaction.
 * @returns - Object containing the draft transaction.
 */
export const getDraftTransaction = (storeId: string, transactionId: string): Record<string, any> => {
    const transactions = getDraftTransactions(storeId)
    return transactions[transactionId]
}

/**
 * Removes a specific draft transaction from local storage.
 * @param storeId - ID of the store.
 * @param transactionId - ID of the transaction.
 */
export const removeDraftTransaction = (storeId: string, transactionId: string) => {
    const key = getLocalStorageKey(storeId);
    const draftTransactions = getDraftTransactions(storeId);
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
export const updateDraftTransactions = (storeId: string, transactionId: string, updatedTransaction: Record<string, any>) => {
    const transactions = getDraftTransactions(storeId)
    transactions[transactionId] = updatedTransaction
    const key = getLocalStorageKey(storeId);
    localStorage.setItem(key, JSON.stringify(transactions))
}






