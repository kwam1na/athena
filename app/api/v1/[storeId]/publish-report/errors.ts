export class ProductNotFoundError extends Error {
    details: any;
    constructor(message: string, details: any) {
        super(message);
        this.details = details;
    }
}

export class InventoryConstraintError extends Error {
    offendingItems: any[];
    constructor(message: string, offendingItems: any[]) {
        super(message);
        this.offendingItems = offendingItems;
    }
}

export class GenericTransactionError extends Error {
    details: any;
    constructor(message: string, details: any) {
        super(message);
        this.details = details;
    }
}