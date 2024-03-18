import { NextRequest, NextResponse } from 'next/server';
import {
   deleteStore,
   getStore,
   updateStore,
} from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import cors from '@/lib/cors';

export async function PATCH(
   req: NextRequest,
   { params }: { params: { storeId: string } },
) {
   try {
      const res = new NextResponse();
      const cookieStore = cookies();
      const supabase = createServerClient(
         process.env.NEXT_PUBLIC_SUPABASE_URL!,
         process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
         {
            cookies: {
               get(name: string) {
                  return cookieStore.get(name)?.value;
               },
               set(name: string, value: string, options: CookieOptions) {
                  cookieStore.set({ name, value, ...options });
               },
               remove(name: string, options: CookieOptions) {
                  cookieStore.set({ name, value: '', ...options });
               },
            },
         },
      );
      const {
         data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user;

      const body = await req.json();
      const { name, currency } = body;

      if (!user) {
         return new NextResponse('Unauthenticated', { status: 403 });
      }

      if (!name) {
         return new NextResponse('Name is required', { status: 400 });
      }

      if (!currency) {
         return new NextResponse('Currency is required', { status: 400 });
      }

      // if (!body.low_stock_threshold) {
      //    return new NextResponse('Low stock threshold is required', {
      //       status: 400,
      //    });
      // }

      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      const storeData = {
         name,
         currency,
         settings: {
            low_stock_threshold: body.low_stock_threshold,
         },
         store_hours: body.store_hours,
         store_location: body.store_location,
         store_phone_number: body.store_phone_number,
      };

      const store = await updateStore(
         parseInt(params.storeId),
         user.id,
         storeData,
      );

      return NextResponse.json(store, res);
   } catch (error) {
      console.log('[STORE_PATCH]', (error as Error).message);
      return new NextResponse('Internal error', { status: 500 });
   }
}

export async function DELETE(
   req: NextRequest,
   { params }: { params: { storeId: string } },
) {
   try {
      const res = new NextResponse();
      const cookieStore = cookies();
      const supabase = createServerClient(
         process.env.NEXT_PUBLIC_SUPABASE_URL!,
         process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
         {
            cookies: {
               get(name: string) {
                  return cookieStore.get(name)?.value;
               },
               set(name: string, value: string, options: CookieOptions) {
                  cookieStore.set({ name, value, ...options });
               },
               remove(name: string, options: CookieOptions) {
                  cookieStore.set({ name, value: '', ...options });
               },
            },
         },
      );
      const {
         data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user;

      if (!user) {
         return new NextResponse('Unauthenticated', { status: 403 });
      }

      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      const store = await deleteStore(parseInt(params.storeId), user.id);
      return NextResponse.json(store, res);
   } catch (error) {
      console.log('[STORE_DELETE]', (error as Error).message);
      return new NextResponse('Internal error', { status: 500 });
   }
}

export async function GET(
   req: NextRequest,
   { params }: { params: { storeId: string } },
) {
   try {
      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      const store = await getStore(parseInt(params.storeId));

      return NextResponse.json(store);
      // return cors(req, NextResponse.json(store));
   } catch (error) {
      console.log('[STORES_GET]', error);
      return new NextResponse('Internal error', { status: 500 });
   }
}
