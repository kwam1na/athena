import { NextRequest, NextResponse } from 'next/server';

import { getService } from '@/lib/repositories/servicesRepository';
import {
   createAppointment,
   fetchAppointments,
} from '@/lib/repositories/appointmentsRepository';
import {
   createCustomer,
   findCustomer,
} from '@/lib/repositories/customersRepository';
import { sendMessage } from '../../../external/sendgrid';
import { format } from 'date-fns';
import { getStore } from '@/lib/repositories/storesRepository';

export async function POST(
   req: NextRequest,
   { params }: { params: { storeId: string } },
) {
   try {
      const res = new NextResponse();

      const body = await req.json();

      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      if (!body.date) {
         return new NextResponse('Date is required', { status: 400 });
      }

      if (!body.time_slot) {
         return new NextResponse('Time slot is required', { status: 400 });
      }

      if (!body.email) {
         return new NextResponse('Customer email is required', { status: 400 });
      }

      if (!body.phone_number) {
         return new NextResponse('Phone number is required', { status: 400 });
      }

      if (!body.first_name) {
         return new NextResponse('First name is required', { status: 400 });
      }

      if (!body.last_name) {
         return new NextResponse('Last name is required', { status: 400 });
      }

      if (!body.service_id) {
         return new NextResponse('Service id is required', { status: 400 });
      }

      const storeId = parseInt(params.storeId);

      const store = await getStore(storeId);

      const customer = await findCustomer({ email: body.email });

      let customerId;

      if (customer) {
         customerId = customer.id;
      } else {
         // Create a new customer if not found
         const newCustomer = await createCustomer({
            email: body.email,
            phone_number: body.phone_number,
            first_name: body.first_name,
            last_name: body.last_name,
            store_id: storeId,
         });
         customerId = newCustomer.id;
      }

      // check if appointment is available for this service
      const service = await getService(body.service_id, {
         appointment: {
            time_slot: body.time_slot,
            date: body.date,
            status: 'pending',
         },
      });

      if (service?.appointments && service?.appointments.length > 0) {
         return NextResponse.json(
            {
               message: 'Already booked',
            },
            { status: 400 },
         );
      }

      const createParams = {
         store_id: storeId,
         customer_id: customerId,
         time_slot: body.time_slot,
         date: body.date,
         service_id: service?.id,
      };

      const appointment = await createAppointment(createParams);

      const storeLocation: any = store?.store_location;

      try {
         const appointmentDetails = {
            customerName: `${body.first_name} ${body.last_name}`,
            customerEmail: body.email,
            appointmentTime: format(
               new Date(body.date),
               "MMMM dd, yyyy 'at' h:mm aaa",
            ),
            serviceName: service?.name,
            location: `${store?.name}, ${storeLocation?.street_address}, ${storeLocation?.city}, ${storeLocation?.country}`,
            storePhoneNumber: store?.store_phone_number,
         };
         sendMessage(appointmentDetails);
      } catch (error) {
         console.log(`error sending message to ${body.email}..`, error);
      }

      return NextResponse.json(appointment, res);
   } catch (error) {
      console.log('[SERVICES_APPOINTMENTS_POST]', (error as Error).message);
      return NextResponse.json(
         {
            error,
         },
         { status: 500 },
      );
   }
}

export async function GET(
   req: NextRequest,
   { params }: { params: { storeId: string } },
) {
   // Create a new NextResponse object
   const response = new NextResponse();

   try {
      const { searchParams } = new URL(req.url);
      const customer_emails = searchParams.get('customer_emails') || undefined;
      const status = searchParams.get('status') || undefined;
      const include_keys = searchParams.get('include_keys') || undefined;

      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      const statuses = status?.split(',');
      const includeForeignKeys = include_keys?.split(',');
      const emailAddresses = customer_emails?.split(',');

      const appointments = await fetchAppointments({
         store_id: parseInt(params.storeId),
         customer_emails: emailAddresses,
         status: statuses,
         includeForeignKeys,
      });

      return NextResponse.json(appointments);
   } catch (error) {
      console.log('[SERVICES_APPOINTMENTS_GET]', (error as Error).message);
      return NextResponse.json(
         {
            error,
         },
         { status: 500 },
      );
   }
}
