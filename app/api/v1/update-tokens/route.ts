import { NextRequest, NextResponse } from 'next/server';


export async function POST(req: NextRequest) {
    try {
        const { access_token, refresh_token } = await req.json();

        const response = new NextResponse('Tokens updated!', { status: 200 });
        response.headers.append('Set-Cookie', `access_token=${access_token}; HttpOnly; Path=/;`);
        response.headers.append('Set-Cookie', `refresh_token=${refresh_token}; HttpOnly; Path=/;`);

        return response;
    } catch (error) {
        console.error('[UPDATE_TOKENS_POST]', error);
        return new NextResponse('Internal error', { status: 500 });
    }
}




