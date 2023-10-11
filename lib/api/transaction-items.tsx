import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api`,
});

// Function to create a new product
export const apiCreateTransactionItem = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/transactionItems`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateTransactionItem = async (
   id: string,
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(
         `/${storeId}/transactionItems/${id}`,
         updatedData,
      );
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetTransactionItem = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/transactionItems/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteTransactionItem = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/transactionItems/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
