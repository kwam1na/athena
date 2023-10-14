import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateSubcategory = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/subcategories`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetSubcategory = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/subcategories/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetSubcategories = async (storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/subcategories`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateSubcategory = async (
   id: string,
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(
         `/${storeId}/subcategories/${id}`,
         updatedData,
      );
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteSubcategory = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/subcategories/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
