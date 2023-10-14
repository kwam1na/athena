import axios from 'axios';

// Configure base settings
const api = axios.create({
    baseURL: `/api/v1`,
});



export const apiRestockAndDeleteTransactionItem = async (itemId: string, storeId: string) => {
    try {
        const response = await api.delete(`/${storeId}/restock/${itemId}`);
        return response.data;
    } catch (error) {
        throw error;
    }
};