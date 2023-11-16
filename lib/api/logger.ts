import axios from 'axios';

// Configure base settings
const api = axios.create({
    baseURL: `/api/v1`,
});

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export const postLog = async (level: LogLevel, message: string, data: Record<string, any>) => {
    try {
        const response = await api.post(`/logs`, { level, message, data });
        return response.data;
    } catch (error) {
        throw error;
    }
}