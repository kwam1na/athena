import prismadb from '@/lib/prismadb';

export const createCustomer = async (data: any) => {
   return await prismadb.customer.create({
      data,
   });
};

export const getCustomer = async (id: string) => {
   return await prismadb.customer.findUnique({
      where: {
         id,
      },
   });
};

export const updateCustomer = async (id: string, data: any) => {
   return await prismadb.customer.update({
      where: {
         id,
      },
      data,
   });
};

export const deleteCustomer = async (id: string) => {
   return await prismadb.customer.delete({
      where: {
         id,
      },
   });
};

export const findCustomer = async (keys: { email: string }) => {
   const where: any = {
      email: {
         equals: keys?.email,
      },
   };

   return await prismadb.customer.findFirst({
      where,
   });
};
