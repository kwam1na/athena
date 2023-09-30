import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { defaultOptions } from './constants';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

export const capitalizeWord = (word: string) => {
    return word.charAt(0).toUpperCase() + word.slice(1)
}

export const requestData = async (url: string, opts?: Record<string, any>) => {
    const mergedOptions = { ...defaultOptions, ...opts };
    console.debug('[requestData] sending request:', { url, mergedOptions })
    let response = await fetch(url, mergedOptions);

    // If the token has expired, refresh it and retry the request
    if (response.headers.get('X-Expired-Token')) {
        console.debug('[requestData] token has expired. requesting refresh token.')
        const refreshResponse = await fetch('/api/refresh-token');
        const { authToken } = await refreshResponse.json();

        mergedOptions.headers['Authorization'] = `Bearer ${authToken}`;

        // Retry the original request
        response = await fetch(url, mergedOptions);
    }

    return response;
};
