import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateProduct = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/products`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetProduct = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/products/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetProducts = async (storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/products`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateProduct = async (
   id: string,
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(
         `/${storeId}/products/${id}`,
         updatedData,
      );
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteProduct = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/products/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
