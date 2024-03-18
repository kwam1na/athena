import { ColumnDef } from '@tanstack/react-table';
import { Service } from '@/lib/types';
import { ServiceCell } from './service-cell';

export const columns: ColumnDef<Service>[] = [
   {
      accessorKey: 'service',
      cell: ({ row }) => <ServiceCell service={row.original} />,
      filterFn: (row, id, filterValue) => {
         const service: Service = row.original;
         const filter = filterValue.toLowerCase();
         return !!service.name.toLowerCase().includes(filter);
      },
   },
];
