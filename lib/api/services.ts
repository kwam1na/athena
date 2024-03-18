import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateService = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/services`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetService = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/services/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetServices = async (storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/services`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateService = async (
   id: string,
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(
         `/${storeId}/services/${id}`,
         updatedData,
      );
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteService = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/services/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
