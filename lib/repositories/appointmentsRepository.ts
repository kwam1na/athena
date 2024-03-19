import prismadb from '@/lib/prismadb';

export const createAppointment = async (data: any) => {
   return await prismadb.appointment.create({
      data,
   });
};

export const getAppointment = async (id: string) => {
   return await prismadb.appointment.findUnique({
      where: {
         id,
      },
   });
};

export const updateAppointment = async (id: string, data: any) => {
   return await prismadb.appointment.update({
      where: {
         id,
      },
      data,
   });
};

export const deleteAppointment = async (id: string) => {
   return await prismadb.appointment.delete({
      where: {
         id,
      },
   });
};

export const fetchAppointments = async (keys: {
   store_id: number;
   customer_emails?: string[];
   status?: string[];
   includeForeignKeys?: string[];
   orderBy?: { [key: string]: 'asc' | 'desc' };
}) => {
   const { store_id, customer_emails, status, orderBy } = keys;

   const where: any = {
      store_id,
      ...(customer_emails && {
         customer: {
            email: {
               in: customer_emails,
            },
         },
      }),
      ...(status && {
         status: {
            in: status,
         },
      }),
   };

   return await prismadb.appointment.findMany({
      where,
      orderBy: orderBy || {
         date: 'asc',
      },
      include: {
         service: true,
         store: {
            select: {
               store_location: true,
            },
         },
         customer: keys.includeForeignKeys?.includes('customer'),
      },
   });
};
