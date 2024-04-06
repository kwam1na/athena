import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
   const response = NextResponse.next();

   const allowedOrigins = [
      'http://localhost:3000',
      'https://rsrv-wigclub.vercel.app',
      'https://wigclub.store',
   ];

   const origin = req.headers.get('Origin');
   if (origin && allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
   }

   response.headers.set(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE',
   );
   response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
   response.headers.set('Access-Control-Allow-Credentials', 'true');

   return response;
}
