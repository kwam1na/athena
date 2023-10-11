import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api`,
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
export const apiDeleteTransaction = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/transactions/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
