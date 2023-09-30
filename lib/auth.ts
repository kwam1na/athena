import jwt from 'jsonwebtoken';

export const fetchRefreshToken = async (refreshToken: string) => {
    const response = await fetch('http:localhost:3000/api/refresh-token', {
        headers: {
            'Authorization': `Bearer ${refreshToken}`,
        },
    });
    const data = await response.json();
    return data.auth_token;
};

export const verifyToken = (token: string): string | null => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || '');
        // @ts-ignore: once decoded, userId property will exist
        return decoded.userId;
    } catch (err) {
        return null;
    }
};