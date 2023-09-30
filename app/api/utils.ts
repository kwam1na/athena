import { ServiceError } from '@/lib/error';
import * as bcrypt from 'bcrypt';
import jwt_decode from "jwt-decode";
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

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

export const useAuth = () => {
    const cookieStore = cookies();
    const token = cookieStore.get('auth_token');
    let userId, decoded;

    // console.debug('[useAuth] auth_token, refresh_token:', token, refresh);

    if (token) {
        try {
            console.debug('[useAuth] verifying token.');
            decoded = jwt.decode(token.value);
            if (decoded) {
                console.debug('[useAuth] initial verification good.');
                // @ts-ignore: once decoded, userId property will exist
                userId = decoded.userId;
            }
        } catch (error) {
            console.error('[useAuth] error:', (error as Error).message);
        }
    }

    return { userId };
};

export const getAuthTokenFromRequest = (request: NextRequest) => {
    const authHeader = request.headers.get('Authorization');

    // console.debug('[getAuthTokenFromRequest] cookies:', request.cookies.get('refresh_token'))
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ServiceError('Unauthorized', 401)
    }

    const token = authHeader.split(' ')[1];
    return { token }
}

export const decodeUserIdFromRequest = (request: NextRequest) => {

    console.debug('[decodeUserIdFromRequest] beginning operations..');
    const { token } = getAuthTokenFromRequest(request)
    const decoded = jwt.decode(token);
    let userId: string | undefined;

    if (decoded) {
        // @ts-ignore: once decoded, userId property will exist
        userId = decoded.userId
    }

    return { userId }
}

export const handleError = (error: any) => {
    let err: ServiceError;
    if (!(error instanceof ServiceError)) {
        err = new ServiceError('Internal server error', 500)
    } else {
        err = error
    }
    return NextResponse.json({ error: err.message }, { status: err.code })
}


// // Issue new access and refresh tokens
export const issueTokens = (userId: string) => {
    const authToken = jwt.sign({ userId }, process.env.JWT_SECRET || '', { expiresIn: '1m' });
    const refreshToken = jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET || '', { expiresIn: '7d' });

    return { authToken, refreshToken };
}

export const tokenExpired = (token: string) => {
    const decoded = jwt_decode(token);
    const currentTime = Math.floor(Date.now() / 1000);

    console.log('decoded:', decoded);
};

export const generateSKU = (category: string, subcategory: string, counter: number) => {
    const categoryCode = category.slice(0, 3).toUpperCase();
    const subcategoryCode = subcategory.slice(0, 3).toUpperCase();

    return `${categoryCode}-${subcategoryCode}-${counter}`;
};