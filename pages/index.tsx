import { supabase } from "../lib/supabase";
import Link from "next/link";
import { useAuth } from "@/context/user";
import { Store } from "@/lib/types";

import Sidebar from "@/components/shared/sidebar";
import axiosInstance from "@/lib/axios";

export default function Home() {
  const { user } = useAuth();
  console.log("use in home:", user);
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
