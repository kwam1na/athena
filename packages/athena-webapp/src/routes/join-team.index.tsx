import { createFileRoute } from "@tanstack/react-router";
import { JoinTeam } from "../components/join-team";

export const Route = createFileRoute("/join-team/")({
  component: () => <JoinTeam />,
});
