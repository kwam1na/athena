import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api`,
});

// Function to create a new product
export const apiCreateSize = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/sizes`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetSize = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/sizes/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetSizes = async (storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/sizes`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateSize = async (
   id: string,
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(`/${storeId}/sizes/${id}`, updatedData);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteSize = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/sizes/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
