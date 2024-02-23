import axios from 'axios';

// Configure base settings
const api = axios.create({
   baseURL: `/api/v1`,
});

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

export const apiAddOrganizationMember = async (
   data: Record<string, any>,
) => {
   try {
      const response = await api.post(`/organizations/members`, data);
      return response.data;
   } catch (error) {
      throw error;
   }
};

export const apiGetOrganizationMemberStatus = async (email: string) => {
   try {
      const response = await api.get(`/organizations/members?email=${email}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

export const apiUpdateOrganizationMember = async (
   updatedData: Record<string, any>,
) => {
   try {
      const response = await api.patch(`/organizations/members`, updatedData);
      return response.data;
   } catch (error) {
      throw error;
   }
};

export const apiGetOrganization = async (id: string) => {
   try {
      const response = await api.get(`/organizations/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

export const apiGetOrganizations = async () => {
   try {
      const response = await api.get(`/organizations`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

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

export const apiDeleteOrganization = async (id: string) => {
   try {
      const response = await api.delete(`/organizations/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};

export const apiDeleteOrganizationMember = async (id: string) => {
   try {
      const response = await api.delete(`/organizations/members/${id}`);
      return response.data;
   } catch (error) {
      throw error;
   }
};
