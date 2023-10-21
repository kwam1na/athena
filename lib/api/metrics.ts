import axios from 'axios';

// Configure base settings
const api = axios.create({
    baseURL: `/api/v1`,
});

// Function to update a product by ID
export const apiGetMetric = async (storeId: string, metric: string) => {
    try {
        const response = await api.get(`/${storeId}/metrics?metric=${metric}`);
        return response.data;
    } catch (error) {
        throw error;
    }
};