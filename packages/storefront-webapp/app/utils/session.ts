// app/services/session.server.ts
import { useSession } from "vinxi/http";

type SessionUser = {
  userEmail: string;
};

export function useAppSession() {
  return useSession<SessionUser>({
    password: "thishastobealongascharacterpassword",
  });
}
