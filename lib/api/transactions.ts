import axios from 'axios';
import { apiGetProduct, apiUpdateProduct } from './products';
import { apiRestockAndDeleteTransactionItem } from './restock';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateTransaction = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/transactions`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to create a new product
export const apiCreateTransactionItemForTransaction = async (
   id: string,
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/transactions/${id}`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetTransaction = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/transactions/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetTransactions = async (storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/transactions`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateTransaction = async (
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(`/${storeId}/transactions`, updatedData);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteTransaction = async (
   id: string,
   storeId: string,
   withRestock?: boolean,
) => {
   try {
      if (withRestock) {
         // Get transaction details
         const transaction = await apiGetTransaction(id, storeId);

         // Create an array of restock promises
         const restockPromises = transaction.transaction_items.map((item: any) => {
            return apiRestockAndDeleteTransactionItem(item.id, storeId);
         });

         // Wait for all restock operations to complete
         await Promise.all(restockPromises);
      }

      // delete transaction
      const response = await api.delete(`/${storeId}/transactions/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
