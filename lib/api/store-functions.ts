import axios, { Axios, AxiosError } from 'axios';
import { ServiceError } from '../error';

// Configure base settings
const api = axios.create({
    baseURL: `/api/v1`,
});

export const apiQueryForProduct = async (storeId: string, query: string) => {
    try {
        const response = await api.get(`/${storeId}/search?query=${query}`);
        return response.data;
    } catch (error) {
        throw error;
    }
}

export const apiPublishReport = async (storeId: string, data: Record<string, any>) => {
    try {
        const response = await api.post(`/${storeId}/publish-report`, data)
        return response.data;
    } catch (error: unknown) {
        const { response } = error as AxiosError;
        const { data } = response || {};
        const d = data as Record<string, any>;
        const message = d?.message || 'An error occurred while publishing report';

        throw new ServiceError(message, response?.status || 500, d);
    }
}