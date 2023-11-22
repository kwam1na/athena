import axios, { AxiosError } from 'axios';
import { ServiceError } from '../error';

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
      const { response } = error as AxiosError;
      const { data } = response || {};
      const { message } = data as Record<string, any> || {};

      throw new ServiceError(message || 'Internal error', response?.status || 500);
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
      const { response } = error as AxiosError;
      const { data } = response || {};
      const { message } = data as Record<string, any> || {};

      throw new ServiceError(message || 'Internal error', response?.status || 500);
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
