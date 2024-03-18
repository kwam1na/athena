import prismadb from '@/lib/prismadb';

export const createService = async (data: any) => {
   return await prismadb.service.create({
      data,
   });
};

export const getService = async (
   id: string,
   keys?: { appointment: { time_slot: string; date: Date; status: string } },
) => {
   return await prismadb.service.findUnique({
      where: {
         id,
      },
      include: {
         appointments: {
            where: {
               time_slot: {
                  equals: keys?.appointment.time_slot,
               },
               date: {
                  equals: keys?.appointment.date,
               },
               status: {
                  equals: keys?.appointment.status,
               },
            },
         },
      },
   });
};

export const updateService = async (id: string, data: any) => {
   // TODO: add support for images
   return await prismadb.service.update({
      where: {
         id,
      },
      data,
   });
};

export const deleteService = async (id: string) => {
   return await prismadb.service.delete({
      where: {
         id,
      },
   });
};

export const fetchServices = async (keys: {
   store_id: number;
   is_archived?: boolean;
   is_active?: boolean;
   appointments?: {
      statuses?: string[];
   };
}) => {
   const { store_id, appointments, ...rest } = keys;

   const where: any = {
      store_id,
      ...rest,
   };

   const currentDate = new Date();

   return await prismadb.service.findMany({
      where,
      orderBy: {
         created_at: 'desc',
      },
      include: {
         appointments: {
            where: {
               date: {
                  gte: currentDate,
               },
               status: {
                  in: appointments?.statuses,
               },
            },
         },
      },
   });
};
