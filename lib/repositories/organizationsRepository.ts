import prismadb from '@/lib/prismadb';

export const createOrganization = async (data: any) => {
    return await prismadb.organization.create({
        data,
    });
}

export const getOrganization = async (id: number) => {
    return await prismadb.organization.findUnique({
        where: {
            id,
        },
        include: {
            members: {
                orderBy: {
                    created_at: 'asc'
                }
            },
            stores: true,
        },
    })
}

export const findOrganization = async (keys: any) => {
    return await prismadb.organization.findFirst({
        where: keys,
    })
}

export const findUserOrganization = async (userId: string) => {
    return await prismadb.organization.findFirst({
        where: {
            members: {
                some: {
                    user_id: userId
                }
            }
        }
    });
}

export const updateOrganization = async (id: number, data: any) => {
    return await prismadb.organization.update({
        where: {
            id,
        },
        data,
    })
}

export const deleteOrganization = async (id: number) => {
    return await prismadb.organization.deleteMany({
        where: {
            id,
        },
    })
}

export const fetchOrganizations = async (userId: string, include?: Record<string, boolean>) => {
    return await prismadb.organization.findMany({
        where: {
            members: {
                some: {
                    user_id: userId
                }
            }
        },
        include,
    });
}