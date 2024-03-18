import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateAppointment = async (
   storeId: string,
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(
         `/${storeId}/services/appointments`,
         data,
      );
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetAppointment = async (id: string, storeId: string) => {
   try {
      const response = await api.get(`/${storeId}/services/appointments/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

export const apiGetAppointments = async (
   storeId: string,
   queryParams?: Record<string, any>,
) => {
   const queryString = new URLSearchParams(queryParams).toString();
   try {
      const url = `/${storeId}/services/appointments${
         queryString ? `?${queryString}` : ''
      }`;
      const response = await api.get(url);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateAppointment = async (
   id: string,
   storeId: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(
         `/${storeId}/services/appointments/${id}`,
         updatedData,
      );
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteAppointment = async (id: string, storeId: string) => {
   try {
      const response = await api.delete(
         `/${storeId}/services/appointments/${id}`,
      );
      return response.data;
   } catch (error) {
      throw error;
   }
};
