import { NextRequest, NextResponse } from 'next/server';

import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
   deleteService,
   getService,
   updateService,
} from '@/lib/repositories/servicesRepository';
import { revalidatePath } from 'next/cache';

export async function GET(
   req: Request,
   { params }: { params: { serviceId: string } },
) {
   try {
      if (!params.serviceId) {
         return new NextResponse('Service id is required', { status: 400 });
      }

      const service = await getService(params.serviceId);
      return NextResponse.json(service);
   } catch (error) {
      console.log('[SERVICE_GET]', (error as Error).message);
      return new NextResponse('Internal error', { status: 500 });
   }
}

export async function DELETE(
   req: NextRequest,
   { params }: { params: { serviceId: string; storeId: string } },
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

      if (!params.serviceId) {
         return new NextResponse('Service id is required', { status: 400 });
      }

      const storeByUserId = await findStore({
         id: parseInt(params.storeId),
         created_by: user.id,
      });

      if (!storeByUserId) {
         return new NextResponse('Unauthorized', { status: 405 });
      }

      const service = await deleteService(params.serviceId);

      return NextResponse.json(service, res);
   } catch (error) {
      console.log('[SERVICE_DELETE]', (error as Error).message);
      return new NextResponse('Internal error', { status: 500 });
   }
}

export async function PATCH(
   req: NextRequest,
   { params }: { params: { serviceId: string; storeId: string } },
) {
   revalidatePath('/services');

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

      if (!user) {
         return new NextResponse('Unauthenticated', { status: 403 });
      }

      if (!params.serviceId) {
         return new NextResponse('Service id is required', { status: 400 });
      }

      const storeByUserId = await findStore({
         id: parseInt(params.storeId),
         created_by: user.id,
      });

      if (!storeByUserId) {
         return new NextResponse('Unauthorized', { status: 405 });
      }

      const service = await updateService(params.serviceId, body);

      return NextResponse.json(service);
   } catch (error) {
      console.log('[SERVICE_PATCH]', (error as Error).message);
      return new NextResponse('Internal error', { status: 500 });
   }
}
