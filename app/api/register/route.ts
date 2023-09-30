import prismadb from '@/lib/prismadb';
import { hashPassword } from '../utils';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export const POST = async (req: Request) => {
    const { name, email, id } = await req.json();

    if (!name) {
        return new NextResponse('Name is required', { status: 400 });
    }

    if (!email) {
        return new NextResponse('Email is required', { status: 400 });
    }

    // Check if the email already exists
    const existingUser = await prismadb.user.findFirst({
        where: {
            email
        }
    });

    if (existingUser) {
        return new NextResponse('Email already exists', { status: 400 });
    }


    const user = await prismadb.user.create({
        data: {
            id,
            name,
            email,
        },
    });

    return NextResponse.json(user);
};
