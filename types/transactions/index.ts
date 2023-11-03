export type ReportEntryAction = 'new' | 'editing';

export type Transaction = {
    id: string;
    reportTitle?: string;
    transactionDate?: Date;
    transactionItems?: TransactionItem[];
    organizationId?: number;
}

export interface TransactionWithoutID {
    reportTitle?: string;
    transactionDate?: Date;
    transactionItems?: TransactionItem[];
}

export type TransactionItem = {
    category?: string;
    categoryId?: string;
    createdAt?: string;
    cost?: string;
    id?: string;
    price?: string;
    productId?: string;
    productName?: string;
    subcategory?: string;
    subcategoryId?: string;
    sku?: string;
    storeId?: number;
    transactionDate?: Date;
    transactionId?: string;
    transactionReportTitle?: string;
    unitsSold?: number;
    updatedAt?: number;
}

export interface TransactionItemBody {
    category?: string;
    category_id?: string;
    cost?: string;
    organization_id?: number;
    price?: string;
    product_id?: string;
    product_name?: string;
    sku?: string;
    store_id?: number;
    subcategory?: string;
    subcategory_id?: string;
    transaction_date?: Date;
    transaction_id?: string;
    transaction_report_title?: string;
    units_sold?: number;
}

export interface AutoSavedTransaction {
    id: string;
    reportTitle?: string;
    transactionDate?: Date;
    transactionItems: TransactionItem[];
}

export interface AlertMessage {
    description?: string;
    key: string;
    title: string;
}