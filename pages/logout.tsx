import { useEffect } from "react";
import * as React from "react";
import { useAuth } from "../context/user";

const Logout = () => {
  const { logout } = useAuth();

  useEffect(() => {
    logout();
  }, []);

  return <p>Logging out</p>;
};

export default Logout;
