import { LocalStorageSync } from "@/lib/local-storage-sync";
import { keysToCamelCase } from "@/lib/utils";
import { AutoSavedTransaction, ReportEntryAction } from "@/types/transactions";

export class ProductsAutosaver extends LocalStorageSync<Record<string, any>> {
    constructor(storeId: string, entryAction: 'new' | 'edit') {
        super(entryAction === 'new' ? `products-${storeId}` : `products-editing-${storeId}`);
    }

    getEditedProduct(storeId: string) {
        return super.getAllWithAlternateKey(`products-editing-${storeId}`);
    }

    removeEditedProduct(transactionId: string, storeId: string) {
        super.removeWithAlternateKey(`products-editing-${storeId}`, transactionId);
    }

    saveEditedProduct(storeId: string, data: Record<string, any>) {
        super.saveWithAlternateKey(`products-editing-${storeId}`, data);
    }
}