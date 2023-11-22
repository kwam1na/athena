import prismadb from '@/lib/prismadb';

export const createUser = async (data: any) => {
    return await prismadb.user.create({
        data,
    });
}

export const getUser = async (id: string) => {
    return await prismadb.user.findUnique({
        where: {
            id,
        },
    })
}

export const getUsers = async () => {
    return await prismadb.user.findMany();
}

export const findUser = async (keys: any) => {
    return await prismadb.user.findFirst({
        where: keys,
    })
}

export const updateUser = async (id: string, data: any) => {
    return await prismadb.user.update({
        where: {
            id,
        },
        data,
    })
}

export const deleteUser = async (id: string) => {
    return await prismadb.user.delete({
        where: {
            id,
        },
    })
}
