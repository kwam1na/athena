import { createFileRoute } from '@tanstack/react-router'
import Dashboard from '@/components/dashboard/Dashboard'

export const Route = createFileRoute(
  '/_authed/$orgUrlSlug/store/$storeUrlSlug/dashboard/',
)({
  component: Dashboard,
})
