import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { defaultOptions } from './constants';

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

