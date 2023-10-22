import axios from 'axios';

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
    } catch (error) {
        throw error;
    }
}