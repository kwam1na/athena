import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateStore = async (
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/stores`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetStore = async (id: string) => {
   try {
      const response = await api.get(`/stores/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetStores = async () => {
   try {
      const response = await api.get(`/stores`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateStore = async (
   id: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(`/stores/${id}`, updatedData);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteStore = async (id: string) => {
   try {
      const response = await api.delete(`/stores/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
