import { NextRequest, NextResponse } from 'next/server';

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
   } catch (error) {
      console.log('[SERVICES_APPOINTMENTS_POST]', (error as Error).message);
      return new NextResponse('Internal error', { status: 500 });
   }
}

export async function GET(
   req: NextRequest,
   { params }: { params: { storeId: string } },
) {
   try {
      const { searchParams } = new URL(req.url);
      const customer_emails = searchParams.get('customer_emails') || undefined;
      const status = searchParams.get('status') || undefined;

      if (!params.storeId) {
         return new NextResponse('Store id is required', { status: 400 });
      }

      const statuses = status?.split(',');
      const emailAddresses = customer_emails?.split(',');

      const appointments = await fetchAppointments({
         store_id: parseInt(params.storeId),
         customer_emails: emailAddresses,
         status: statuses,
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
