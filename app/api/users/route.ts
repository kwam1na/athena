import { NextRequest, NextResponse } from 'next/server';
import { decodeUserIdFromRequest, handleError } from '../utils';
import prismadb from '@/lib/prismadb';

export async function GET(
    req: NextRequest,
) {
    try {
        console.debug('[USERS_GET] beginning operations..')
        const { userId } = decodeUserIdFromRequest(req);

        if (!userId) {
            return new NextResponse('Unauthorized', { status: 403 });
        }

        const user = await prismadb.user.findFirst({
            where: {
                id: userId,
            },
        });

        if (!user) {
            return new NextResponse('No user with passed in id', { status: 404 });
        }

        return NextResponse.json(user);
    } catch (error) {
        console.error('[USERS_GET] error:', (error as Error).message);
        return handleError(error)
    }
}