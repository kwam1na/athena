import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api`,
});

// Function to create a new product
export const apiCreateColor = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/colors`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetColor = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/colors/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetColors = async (storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/colors`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateColor = async (
   id: string,
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(`/${storeId}/colors/${id}`, updatedData);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteColor = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/colors/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
