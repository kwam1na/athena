import axios, { AxiosError } from 'axios';
import { ServiceError } from '../error';
import { translateAxiosErorToServiceError } from '../utils';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

export const apiCreateUser = async (
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/users`, data);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};

export const apiGetUser = async () => {
   try {
      const response = await api.get(`/users`);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};

export const apiGetUsers = async () => {
   try {
      const response = await api.get(`/users`);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};

export const apiUpdateUser = async (
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(`/users`, updatedData);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};

export const apiDeleteUser = async () => {
   try {
      const response = await api.delete(`/users`);
      return response.data;
   } catch (error) {
      const translatedError = translateAxiosErorToServiceError(error)
      throw translatedError;
   }
};
