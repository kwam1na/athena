import axios from 'axios';
import { translateAxiosErorToServiceError } from '../utils';

const api = axios.create({
   baseURL: `/api/v1`,
});

export const apiCreateCategory = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/${storeId}/categories`, data);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};

export const apiGetCategory = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/categories/${id}`);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};

export const apiGetCategories = async (storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/categories`);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};

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
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};

export const apiDeleteCategory = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(`/${storeId}/categories/${id}`);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};
