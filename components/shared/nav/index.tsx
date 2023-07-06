import Link from "next/link";
import * as React from "react";
import { useAuth } from "@/context/user";

const Nav = () => {
  const { user } = useAuth();

  return (
    <nav className="flex py-6 px-16 border-b border-gray-500">
      <Link href="/">
        <p>athena</p>
      </Link>
      {!!user && (
        <Link href="/dashboard">
          <p className="ml-2">/ {user?.store?.name}</p>
        </Link>
      )}

      <div className="ml-auto">
        <Link href={user ? "/logout" : "/login"}>
          <p>{user ? "Logout" : "Login"}</p>
        </Link>
      </div>
    </nav>
  );
};

export default Nav;
