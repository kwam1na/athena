import { LocalStorageSync } from "@/lib/local-storage-sync";
import { keysToCamelCase } from "@/lib/utils";
import { AutoSavedTransaction, ReportEntryAction } from "@/types/transactions";

export class TransactionsAutosaver extends LocalStorageSync<Record<string, any>> {
    constructor(storeId: string, entryAction: ReportEntryAction) {
        super(entryAction === 'new' ? `transactions-${storeId}` : `transactions-editing-${storeId}`);
    }

    getAutosavedTransactions() {
        const draftTransactions = this.getAll();
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
    }

    getEditedTransactions(storeId: string) {
        return super.getAllWithAlternateKey(`transactions-editing-${storeId}`);
    }

    removeEditedTransactions(transactionId: string, storeId: string) {
        super.removeWithAlternateKey(`transactions-editing-${storeId}`, transactionId);
    }

    saveEditedTransactions(storeId: string, data: Record<string, any>) {
        super.saveWithAlternateKey(`transactions-editing-${storeId}`, data);
    }
}