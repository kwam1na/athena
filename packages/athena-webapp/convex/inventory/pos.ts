export {
  search as searchProducts,
  barcodeLookup as lookupByBarcode,
} from "../pos/public/catalog";
export {
  updateInventory,
  completeTransaction,
  getTransaction,
  getTransactionsByStore,
  getCompletedTransactions,
  getTransactionById,
  voidTransaction,
  createTransactionFromSession,
  getRecentTransactionsWithCustomers,
  getTodaySummary,
} from "../pos/public/transactions";
export {
  createTransactionFromSessionHandler,
  recordRegisterSessionSale,
} from "../pos/application/commands/completeTransaction";
