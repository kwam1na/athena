import "@/styles/globals.css";
import type { AppProps } from "next/app";
import AuthProvider from "@/context/user";
import Nav from "@/components/shared/nav";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Nav />
      <Component {...pageProps} />
    </AuthProvider>
  );
}
