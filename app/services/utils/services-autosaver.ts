import { LocalStorageSync } from "@/lib/local-storage-sync";

export class ServicesAutosaver extends LocalStorageSync<Record<string, any>> {
    constructor(storeId: string, entryAction: 'new' | 'edit') {
        super(entryAction === 'new' ? `services-${storeId}` : `services-editing-${storeId}`);
    }

    getEditedProduct(storeId: string) {
        return super.getAllWithAlternateKey(`services-editing-${storeId}`);
    }

    removeEditedProduct(transactionId: string, storeId: string) {
        super.removeWithAlternateKey(`services-editing-${storeId}`, transactionId);
    }

    saveEditedProduct(storeId: string, data: Record<string, any>) {
        super.saveWithAlternateKey(`services-editing-${storeId}`, data);
    }
}