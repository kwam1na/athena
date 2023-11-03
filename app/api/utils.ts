import { ServiceError } from '@/lib/error';
import * as bcrypt from 'bcrypt';
import jwt_decode from "jwt-decode";
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export const hashPassword = async (password: string) => {
    const saltRounds = 10;
    try {
        const salt = await bcrypt.genSalt(saltRounds);
        const hashedPassword = await bcrypt.hash(password, salt);
        return hashedPassword;
    } catch (error) {
        console.error('Error hashing password:', error);
        throw error;
    }
};

export const isValidPassword = async (
    password: string,
    hashedPassword: string,
) => {
    return await bcrypt.compare(password, hashedPassword);
};



export const generateSKU = (category: string, subcategory: string, counter: number) => {
    const categoryCode = category.slice(0, 3).toUpperCase();
    const subcategoryCode = subcategory.slice(0, 3).toUpperCase();

    return `${categoryCode}-${subcategoryCode}-${counter}`;
};

export const createSupabaseServerClient = () => {
    const cookieStore = cookies()
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return cookieStore.get(name)?.value
                },
                set(name: string, value: string, options: CookieOptions) {
                    cookieStore.set({ name, value, ...options })
                },
                remove(name: string, options: CookieOptions) {
                    cookieStore.set({ name, value: '', ...options })
                },
            },
        }
    )
}