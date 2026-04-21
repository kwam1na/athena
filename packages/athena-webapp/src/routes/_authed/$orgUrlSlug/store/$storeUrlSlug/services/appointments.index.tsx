import { createFileRoute } from "@tanstack/react-router";
import { ServiceAppointmentsView } from "~/src/components/services/ServiceAppointmentsView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/services/appointments/"
)({
  component: ServiceAppointmentsView,
});
