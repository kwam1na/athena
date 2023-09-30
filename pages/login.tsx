import * as React from "react";

import { useEffect } from "react";
import { useAuth } from "@/context/user";

const Login = () => {
  const { login } = useAuth();

  useEffect(() => {
    login();
  }, []);

  return <p>Logging in</p>;
};

export default Login;
