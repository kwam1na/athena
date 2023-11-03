import axios, { AxiosError } from 'axios';
import { ServiceError } from '../error';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateUser = async (
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/users`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetUser = async () => {
   try {
      const response = await api.get(`/users`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetUsers = async () => {
   try {
      const response = await api.get(`/users`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateUser = async (
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(`/users`, updatedData);
      return response.data;
   } catch (error) {
      const { response } = error as AxiosError;
      const { data } = response || {};
      const { message } = data as Record<string, any> || {};

      throw new ServiceError(message || 'Internal error', response?.status || 500);
   }
};

// Function to delete a product by ID
export const apiDeleteUser = async () => {
   try {
      const response = await api.delete(`/users`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
