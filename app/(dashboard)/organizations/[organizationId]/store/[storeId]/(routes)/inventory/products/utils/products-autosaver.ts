import { LocalStorageSync } from "@/lib/local-storage-sync";
import { keysToCamelCase } from "@/lib/utils";
import { AutoSavedTransaction, ReportEntryAction } from "@/types/transactions";

export class ProductsAutosaver extends LocalStorageSync<Record<string, any>> {
    constructor(storeId: string) {
        super(`products-${storeId}`);
    }
}