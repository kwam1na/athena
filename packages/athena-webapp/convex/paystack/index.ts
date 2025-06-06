import { v } from "convex/values";

/**
 * Lists all transactions for the Paystack integration
 * @returns List of transactions from Paystack
 */
export const listTransactions = async (params: {
  perPage?: number;
  page?: number;
  status?: "failed" | "success" | "abandoned" | "pending";
  from?: string; // ISO date string
  to?: string; // ISO date string
  customerEmail?: string; // Customer email to filter by (client-side filtering)
  createdAfter?: number; // Unix timestamp in milliseconds
  sameDay?: number; // Unix timestamp in milliseconds to match transactions on the same day
}) => {
  // Build query parameters
  const queryParams = new URLSearchParams();

  if (params.perPage) queryParams.append("perPage", params.perPage.toString());
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.status) queryParams.append("status", params.status);
  if (params.from) queryParams.append("from", params.from);
  if (params.to) queryParams.append("to", params.to);
  // We'll filter by email manually instead of using the API parameter
  // if (params.customerEmail) queryParams.append("customer", params.customerEmail);

  const queryString = queryParams.toString();
  const endpoint = `https://api.paystack.co/transaction${queryString ? `?${queryString}` : ""}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Failed to list transactions", errorData);
    throw new Error(
      `Failed to list transactions: ${errorData.message || "Unknown error"}`
    );
  }

  const responseData = await response.json();

  if (responseData.data) {
    let filteredData = responseData.data;

    // Filter transactions by customer email if provided
    if (params.customerEmail) {
      filteredData = filteredData.filter(
        (transaction: any) =>
          transaction.customer &&
          transaction.customer.email &&
          transaction.customer.email.toLowerCase() ===
            params.customerEmail?.toLowerCase()
      );
    }

    // Filter transactions by creation time if provided
    if (params.createdAfter !== undefined) {
      const createdAfterTimestamp = params.createdAfter;
      filteredData = filteredData.filter((transaction: any) => {
        if (!transaction.createdAt) return false;

        // Convert the Paystack ISO timestamp to milliseconds
        const transactionCreatedAt = new Date(transaction.createdAt).getTime();
        return transactionCreatedAt >= createdAfterTimestamp;
      });
    }

    // Filter transactions by same day if provided
    if (params.sameDay !== undefined) {
      // Convert timestamp to date in local timezone
      const sameDayDate = new Date(params.sameDay);
      const year = sameDayDate.getFullYear();
      const month = sameDayDate.getMonth();
      const day = sameDayDate.getDate();

      filteredData = filteredData.filter((transaction: any) => {
        if (!transaction.createdAt) return false;

        // Convert the Paystack ISO timestamp to date
        const transactionDate = new Date(transaction.createdAt);

        // Check if year, month, and day are the same
        return (
          transactionDate.getFullYear() === year &&
          transactionDate.getMonth() === month &&
          transactionDate.getDate() === day
        );
      });
    }

    responseData.data = filteredData;
  }

  return responseData;
};

/**
 * Verifies a transaction status
 * @param reference Transaction reference to verify
 * @returns Transaction verification details
 */
export const verifyTransaction = async (reference: string) => {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Failed to verify transaction", errorData);
    throw new Error(
      `Failed to verify transaction: ${errorData.message || "Unknown error"}`
    );
  }

  return await response.json();
};
