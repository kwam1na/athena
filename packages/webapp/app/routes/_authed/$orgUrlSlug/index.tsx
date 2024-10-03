import OrganizationView from '@/components/OrganizationView'
import { NotFoundView } from '@/components/states/not-found/NotFoundView'
import { getOrganization } from '@/server-actions/organizations'
import { createFileRoute, notFound } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/$orgUrlSlug/')({
  loader: async ({ params: { orgUrlSlug } }) => {
    const org = await getOrganization(orgUrlSlug)

    if (!org) throw notFound()

    return org
  },
  component: OrganizationView,
  notFoundComponent: () => {
    const { orgUrlSlug } = Route.useParams()
    return <NotFoundView entity="organization" entityIdentifier={orgUrlSlug} />
  },
})
