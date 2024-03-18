'use client';

import { ColumnDef } from '@tanstack/react-table';
import { AppointmentCell } from './appointment-cell';
import { Appointment } from '@/lib/types';

export const columns: ColumnDef<Appointment>[] = [
   {
      accessorKey: 'appointment',
      cell: ({ row }) => <AppointmentCell appointment={row.original} />,
      filterFn: (row, id, filterValue) => {
         const appointment: Appointment = row.original;
         const filter = filterValue.toLowerCase();
         const fullName =
            `${appointment.customer?.first_name} ${appointment.customer?.last_name}`.toLowerCase();
         return (
            !!appointment.service?.name.toLowerCase().includes(filter) ||
            !!appointment.customer?.email?.includes(filter) ||
            !!appointment.customer?.first_name
               ?.toLowerCase()
               ?.includes(filter) ||
            !!appointment.customer?.last_name
               ?.toLowerCase()
               ?.includes(filter) ||
            fullName.includes(filter)
         );
      },
   },
];
