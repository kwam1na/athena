import { NextRequest, NextResponse } from 'next/server';

import cors from '@/lib/cors';
import {
   fetchAppointments,
   updateAppointment,
} from '@/lib/repositories/appointmentsRepository';

export async function PATCH(
   req: NextRequest,
   { params }: { params: { appointmentId: string } },
) {
   try {
      const res = new NextResponse();

      const body = await req.json();

      if (!params.appointmentId) {
         return new NextResponse('Appointment id is required', { status: 400 });
      }

      if (!body.action) {
         return new NextResponse('Action is required', { status: 400 });
      }

      // if (!body.action) {
      //    return cors(
      //       req,
      //       NextResponse.json(
      //          { error: 'Action is required.' },
      //          {
      //             status: 400,
      //          },
      //       ),
      //    );
      // }

      //   if (!body.time_slot) {
      //      return new NextResponse('Time slot is required', { status: 400 });
      //   }

      //   if (!body.email) {
      //      return cors(
      //         req,
      //         NextResponse.json(
      //            { error: 'Customer email is required.' },
      //            {
      //               status: 400,
      //            },
      //         ),
      //      );
      //   }

      //   if (!body.phone_number) {
      //      return cors(
      //         req,
      //         NextResponse.json(
      //            { error: 'Customer email is required.' },
      //            {
      //               status: 400,
      //            },
      //         ),
      //      );
      //   }

      let appointment;

      if (body.action == 'cancel') {
         appointment = await updateAppointment(params.appointmentId, {
            status: 'canceled',
            canceled_at_time: new Date(),
         });
      }

      if (body.action == 'check-in') {
         appointment = await updateAppointment(params.appointmentId, {
            status: 'in-progress',
            check_in_time: new Date(),
         });
      }

      if (body.action == 'end') {
         appointment = await updateAppointment(params.appointmentId, {
            status: 'ended',
            end_time: new Date(),
         });
      }

      return NextResponse.json(appointment, res);
      // return cors(req, NextResponse.json(appointment, res));
   } catch (error) {
      console.log('[SERVICES_APPOINTMENTS_POST]', (error as Error).message);
      return new NextResponse('Internal error', { status: 500 });
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
      const customer_email = searchParams.get('customer_email') || undefined;
      const status = searchParams.get('status') || undefined;

      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      const statuses = status?.split(',');

      const appointments = await fetchAppointments({
         store_id: parseInt(params.storeId),
         customer_email,
         status: statuses,
      });

      return NextResponse.json(appointments);

      // return cors(req, NextResponse.json(appointments));
   } catch (error) {
      console.log('[SERVICES_APPOINTMENTS_GET]', (error as Error).message);
      // Add CORS headers to the error response
      return new NextResponse('Internal error', {
         status: 500,
         headers: response.headers,
      });
   }
}

// export async function OPTIONS(request: NextRequest) {
//    return cors(
//       request,
//       new NextResponse(null, {
//          status: 204,
//       }),
//    );
// }
