import SettingsView from '@/components/SettingsView'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/$orgUrlSlug/settings/')({
  component: SettingsView,
})
