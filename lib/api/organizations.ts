import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

// Function to create a new product
export const apiCreateOrganization = async (
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/organizations`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetOrganization = async (id: string) => {
   try {
      const response = await api.get(`/organizations/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiGetOrganizations = async () => {
   try {
      const response = await api.get(`/organizations`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to update a product by ID
export const apiUpdateOrganization = async (
   id: string,
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(`/organizations/${id}`, updatedData);
      return response.data;
   } catch (error) {
      throw error;
   }
};

// Function to delete a product by ID
export const apiDeleteOrganization = async (id: string) => {
   try {
      const response = await api.delete(`/organizations/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
