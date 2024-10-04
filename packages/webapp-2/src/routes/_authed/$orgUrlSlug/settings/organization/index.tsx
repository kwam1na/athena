import OrganizationSettingsView from '@/settings/organization/components/OrganizationSettingsView'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_authed/$orgUrlSlug/settings/organization/',
)({
  component: OrganizationSettingsView,
})
