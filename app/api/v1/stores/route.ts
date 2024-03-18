import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prismadb';
import { createStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { getUser } from '@/lib/repositories/userRepository';

export async function POST(req: NextRequest) {
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
         return new NextResponse('Unauthorized', { status: 403 });
      }

      if (!name) {
         return new NextResponse('Name is required', { status: 400 });
      }

      if (!currency) {
         return new NextResponse('Currency is required', { status: 400 });
      }

      if (!body.organization_id) {
         return new NextResponse('Organization id is required', {
            status: 400,
         });
      }

      if (user.id === 'abe16fa9-53f8-42a8-ab12-01cc4c9ac5b5') {
         return NextResponse.json({ id: 4 }, res);
      }

      // set the low_stock_threshold to 10 by default for all new stores
      const settings = {
         low_stock_threshold: parseInt(body.low_stock_threshold) || 10,
      };

      const createParams = {
         name: body.name,
         currency: body.currency,
         organization: {
            connect: { id: parseInt(body.organization_id) },
         },
         created_by: user.id,
         settings,
         store_hours: body.store_hours,
         store_location: body.store_location,
      };
      const store = await createStore(createParams);

      await prismadb.user.update({
         where: {
            id: user.id,
         },
         data: {
            store_id: store.id,
         },
      });

      return NextResponse.json(store, res);
   } catch (error) {
      console.log('[STORES_POST]', error);
      return new NextResponse('Internal error', { status: 500 });
   }
}
