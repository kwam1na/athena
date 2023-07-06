import { supabase } from "../lib/supabase";
import Link from "next/link";
import { useAuth } from "@/context/user";
import { Store } from "@/lib/types";
import * as React from "react";

import Sidebar from "@/components/shared/sidebar";
import axiosInstance from "@/lib/axios";

export default function Home() {
  const { user } = useAuth();
  // console.log("use in home:", user);

  React.useEffect(() => {
    if (window.location.hash) {
      const hash = window.location.hash
        .substring(1)
        .split("&")
        .reduce((initial: { [key: string]: string }, item: string) => {
          if (item) {
            var parts = item.split("=");
            initial[parts[0]] = decodeURIComponent(parts[1]);
          }
          return initial;
        }, {});
      history.replaceState(null, "", "/");

      console.log("hash:", hash);
    }
  }, []);
  return user && <Sidebar />;
}

export const getStaticProps = async () => {
  const response = await axiosInstance.get("/stores");

  return {
    props: {
      stores: response.data,
    },
    revalidate: 60,
  };
};
