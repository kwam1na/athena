import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

type PromiseResult<T> =
    | { status: "fulfilled"; value: T }
    | { status: "rejected"; reason: any };

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const formatter = (currency: string) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
});

export const capitalizeWord = (word: string) => {
    return word.charAt(0).toUpperCase() + word.slice(1)
}

export const trimString = (str: string) => {
    return str.trim();
}

// Convert camelCase to snake_case
export const toSnakeCase = (str: string) => {
    return str.replace(/[A-Z]/g, (letter: string) => `_${letter.toLowerCase()}`);
}

// Convert snake_case to camelCase
export const toCamelCase = (str: string) => {
    return str.replace(/_([a-z])/g, (g: string) => g[1].toUpperCase());
}

// Convert object keys from camelCase to snake_case
export const keysToSnakeCase = (obj: Record<string, any>) => {
    const newObj: Record<string, any> = {};
    for (const key in obj) {
        newObj[toSnakeCase(key)] = obj[key];
    }
    return newObj;
}

// Convert object keys from snake_case to camelCase
export const keysToCamelCase = (obj: Record<string, any>) => {
    const newObj: Record<string, any> = {};
    for (const key in obj) {
        newObj[toCamelCase(key)] = obj[key];
    }
    return newObj;
}


export const reflect = <T>(promise: Promise<T>): Promise<PromiseResult<T>> => {
    return promise.then(
        (value): PromiseResult<T> => ({ status: "fulfilled", value }),
        (error): PromiseResult<T> => ({ status: "rejected", reason: error })
    );
};
