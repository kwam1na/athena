import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateCategory = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/categories`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetCategory = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/categories/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetCategories = async (storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/categories`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateCategory = async (
   id: string,
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(
         `/${storeId}/categories/${id}`,
         updatedData,
      );
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteCategory = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/categories/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
