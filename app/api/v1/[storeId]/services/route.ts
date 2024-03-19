import { NextRequest, NextResponse } from 'next/server';

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
   createService,
   fetchServices,
} from '@/lib/repositories/servicesRepository';

const addCorsHeaders = (response: NextResponse) => {
   response.headers.set('Access-Control-Allow-Origin', '*');
   response.headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS, PUT, DELETE',
   );
   response.headers.set('Access-Control-Allow-Credentials', 'true');
   response.headers.set(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept',
   );
   // Add any other headers you need to set
};

export async function POST(
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

      const { name, price } = body;

      if (!user) {
         return new NextResponse('Unauthenticated', { status: 403 });
      }

      if (!name) {
         return new NextResponse('Name is required', { status: 400 });
      }

      if (!price) {
         return new NextResponse('Price is required', { status: 400 });
      }

      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      if (!body.organization_id) {
         return new NextResponse('Organization id is required', {
            status: 400,
         });
      }

      if (!body.start_time) {
         return new NextResponse('Start time is required', { status: 400 });
      }

      if (!body.end_time) {
         return new NextResponse('End time is required', { status: 400 });
      }

      const storeId = parseInt(params.storeId);

      // const storeByUserId = await findStore({
      //     id: storeId,
      //     created_by: user.id,
      // });

      // TODO: better way of authorizing..
      // if (!storeByUserId) {
      //     return new NextResponse('Unauthorized', { status: 405 });
      // }

      const createParams = {
         ...body,
         store_id: storeId,
         organization_id: parseInt(body.organization_id),
      };
      const service = await createService(createParams);

      return NextResponse.json(service, res);
   } catch (error) {
      console.log('[SERVICES_POST]', (error as Error).message);
      return new NextResponse('Internal error', { status: 500 });
   }
}

export async function GET(
   req: NextRequest,
   { params }: { params: { storeId: string } },
) {
   try {
      const { searchParams } = new URL(req.url);
      const is_archived = searchParams.get('isArchived');
      const is_active = searchParams.get('isActive');
      const status = searchParams.get('appointment.status');

      const statuses = status?.split(',');

      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      const services = await fetchServices({
         store_id: parseInt(params.storeId),
         is_active: is_active ? Boolean(is_active) : true,
         is_archived: is_archived ? Boolean(is_archived) : false,
         appointments: {
            statuses,
         },
      });

      return NextResponse.json(services);
   } catch (error) {
      console.log('[SERVICES_GET]', (error as Error).message);
      return NextResponse.json(
         { error },
         {
            status: 500,
         },
      );
   }
}
