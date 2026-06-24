import { Login } from "~/src/components/auth/Login";

export function AthenaLoginReadyView() {
  return (
    <section data-testid="athena-login-ready">
      <Login />
    </section>
  );
}
