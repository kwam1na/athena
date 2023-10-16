import prismadb from '@/lib/prismadb';
import { checkForOffendingItems, checkIfItemsUpdated, checkInventoryConstraints } from '@/app/api/v1/[storeId]/publish-report/utils';
import { ProductNotFoundError } from '@/app/api/v1/[storeId]/publish-report/errors';

jest.mock('@/lib/prismadb', () => ({
    product: {
        findUnique: jest.fn()
    }
}));

beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => { });
});

describe('when checkIfItemsUpdated is invoked', () => {
    it('should return true for a new report', () => {
        const newTransactionItems = [{ id: '1', units_sold: 2 }, { id: '2', units_sold: 3 }];
        expect(checkIfItemsUpdated(newTransactionItems)).toBe(true);
    });

    it('should return true if new items are added', () => {
        const existingTransaction = {
            id: '1',
            transaction_items: [{ id: '1', units_sold: 2 }, { id: '2', units_sold: 3 }]
        };
        const newTransactionItems = [{ id: '1', units_sold: 2 }, { id: '2', units_sold: 3 }, { id: '3', units_sold: 4 }];
        expect(checkIfItemsUpdated(newTransactionItems, existingTransaction)).toBe(true);
    });

    it('should return true if units sold is updated', () => {
        const existingTransaction = {
            id: '1',
            transaction_items: [{ id: '1', units_sold: 2 }, { id: '2', units_sold: 3 }]
        };
        const newTransactionItems = [{ id: '1', units_sold: 2 }, { id: '2', units_sold: 4 }];
        expect(checkIfItemsUpdated(newTransactionItems, existingTransaction,)).toBe(true);
    });

    it('should return false if no changes', () => {
        const existingTransaction = {
            id: '1',
            transaction_items: [{ id: '1', units_sold: 2 }, { id: '2', units_sold: 3 }]
        };
        const newTransactionItems = [{ id: '1', units_sold: 2 }, { id: '2', units_sold: 3 }];
        expect(checkIfItemsUpdated(newTransactionItems, existingTransaction)).toBe(false);
    });
});

describe('when checkForOffendingItems is invoked', () => {
    it('should add to offendingItems if inventoryChange is negative and existingItem exists', () => {
        const offendingItems: Record<string, any>[] = [];
        const existingItem = { product_id: '1', product_name: 'test-product', units_sold: 2 };
        const updatedItem = { product_id: '1', product_name: 'test-product', units_sold: 9 };
        const product = { product_id: '1', product_name: 'test-product', inventory_count: 5 };

        checkForOffendingItems({ existingItem, item: updatedItem, product, offendingItems })

        expect(offendingItems).toEqual([
            {
                product_id: '1',
                product_name: 'test-product',
                inventory_count: 5,
                updated_provided_units_sold: 9,
                existing_units_sold: 2
            }
        ]);
    });

    it('should not update offendingItems if inventoryChange is positive or zero', () => {
        const offendingItems: any[] = [];
        const existingItem = { product_id: '1', product_name: 'test-product', units_sold: 2 };
        const updatedItem = { product_id: '1', product_name: 'test-product', units_sold: 4 };
        const product = { product_id: '1', product_name: 'test-product', inventory_count: 5 };

        checkForOffendingItems({ existingItem, item: updatedItem, product, offendingItems })

        expect(offendingItems).toEqual([]);
    });

    it('should add to offendingItems if no existingItem and item.units_sold > product.count', () => {
        const offendingItems: any[] = [];
        const updatedItem = { product_id: '1', product_name: 'test-product', units_sold: 9 };
        const product = { product_id: '1', product_name: 'test-product', inventory_count: 5 };

        checkForOffendingItems({ item: updatedItem, product, offendingItems })

        expect(offendingItems).toEqual([
            {
                product_id: '1',
                product_name: 'test-product',
                inventory_count: 5,
                provided_units_sold: 9,
            }
        ]);
    });

    it('should not update offendingItems if no existingItem and item.units_sold <= product.count', () => {
        const offendingItems: any[] = [];
        const updatedItem = { product_id: '1', product_name: 'test-product', units_sold: 5 };
        const product = { product_id: '1', product_name: 'test-product', inventory_count: 5 };

        checkForOffendingItems({ item: updatedItem, product, offendingItems })

        expect(offendingItems).toEqual([]);
    });

    it('should handle scenarios when product is null or undefined', () => {
        const offendingItems: any[] = [];
        const updatedItem = { product_id: '1', product_name: 'test-product', units_sold: 9 };

        checkForOffendingItems({ item: updatedItem, offendingItems })

        expect(offendingItems).toEqual([
            {
                product_id: '1',
                product_name: 'test-product',
                inventory_count: 0,
                provided_units_sold: 9,
            }
        ]);
    });
});

describe('when checkInventoryConstraints is invoked', () => {
    it('should return offendingItems for a new transaction', async () => {
        (prismadb.product.findUnique as jest.Mock).mockResolvedValueOnce({ product_id: '1', product_name: 'test-product', inventory_count: 5 });

        const result = await checkInventoryConstraints(prismadb, true, [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 9 }], undefined);
        const expectedResponse = {
            status: 'success',
            offendingItems: [
                {
                    product_id: '1',
                    product_name: 'test-product',
                    inventory_count: 5,
                    provided_units_sold: 9
                }
            ]
        };
        expect(result).toEqual(expectedResponse);
    });

    it('should return all offendingItems for a transaction', async () => {
        (prismadb.product.findUnique as jest.Mock).mockResolvedValueOnce({ product_id: '1', product_name: 'test-product', inventory_count: 5 }).mockResolvedValueOnce({ product_id: '2', product_name: 'test-product', inventory_count: 1 });

        const result = await checkInventoryConstraints(prismadb, true, [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 9 }, { id: '2', product_id: '2', product_name: 'test-product', units_sold: 9 }], undefined);
        const expectedResponse = {
            status: 'success',
            offendingItems: [
                {
                    product_id: '1',
                    product_name: 'test-product',
                    inventory_count: 5,
                    provided_units_sold: 9
                },
                {
                    product_id: '2',
                    product_name: 'test-product',
                    inventory_count: 1,
                    provided_units_sold: 9
                }
            ]
        };
        expect(result).toEqual(expectedResponse);
    });

    it('should return empty offendingItems if no offending items', async () => {
        (prismadb.product.findUnique as jest.Mock).mockResolvedValueOnce({ product_id: '1', product_name: 'test-product', inventory_count: 15 });

        const result = await checkInventoryConstraints(prismadb, true, [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 9 }], undefined);
        const expectedResponse = {
            status: 'success',
            offendingItems: []
        };
        expect(result).toEqual(expectedResponse);
    });

    it('should handle database errors', async () => {
        (prismadb.product.findUnique as jest.Mock).mockRejectedValue(new Error('error finding product'));

        await expect(
            checkInventoryConstraints(prismadb, true, [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 9 }], undefined)
        ).rejects.toThrow(ProductNotFoundError);
    });

    it('should handle when existingTransaction exists and there are changes to the transaction items (negative inventory change)', async () => {
        (prismadb.product.findUnique as jest.Mock).mockResolvedValueOnce({ product_id: '1', product_name: 'test-product', inventory_count: 5 });

        const existingTransaction = {
            id: '1',
            transaction_items: [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 10 }]
        };
        const result = await checkInventoryConstraints(prismadb, true, [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 19 }], existingTransaction);
        const expectedResponse = {
            status: 'success',
            offendingItems: [
                {
                    product_id: '1',
                    product_name: 'test-product',
                    inventory_count: 5,
                    updated_provided_units_sold: 19,
                    existing_units_sold: 10
                }
            ]
        };
        expect(result).toEqual(expectedResponse);
    });

    it('should handle when existingTransaction exists and there are changes to the transaction items (positive inventory change)', async () => {
        (prismadb.product.findUnique as jest.Mock).mockResolvedValueOnce({ product_id: '1', product_name: 'test-product', inventory_count: 5 });

        const existingTransaction = {
            id: '1',
            transaction_items: [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 10 }]
        };
        const result = await checkInventoryConstraints(prismadb, true, [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 8 }], existingTransaction);
        const expectedResponse = {
            status: 'success',
            offendingItems: []
        };
        expect(result).toEqual(expectedResponse);
    });

    it('should handle when existingTransaction exists and there are changes to the transaction items (no inventory change)', async () => {
        (prismadb.product.findUnique as jest.Mock).mockResolvedValueOnce({ product_id: '1', product_name: 'test-product', inventory_count: 5 });

        const existingTransaction = {
            id: '1',
            transaction_items: [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 19 }]
        };
        const result = await checkInventoryConstraints(prismadb, false, [{ id: '1', product_id: '1', product_name: 'test-product', units_sold: 19 }], existingTransaction);
        const expectedResponse = {
            status: 'success',
            offendingItems: []
        };
        expect(result).toEqual(expectedResponse);
    });
});