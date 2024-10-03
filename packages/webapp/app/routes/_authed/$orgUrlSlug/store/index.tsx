import { NotFoundView } from '@/components/states/not-found/NotFoundView'
import StoreView from '@/components/StoreView'
import { getOrganization } from '@/server-actions/organizations'
import { getStores } from '@/server-actions/stores'
import { createFileRoute, notFound } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/$orgUrlSlug/store/')({
  loader: async ({ params: { orgUrlSlug } }) => {
    const org = await getOrganization(orgUrlSlug)

    if (!org) throw notFound()

    const stores = await getStores(org.id)

    return {
      org,
      stores,
    }
  },

  component: StoreView,

  notFoundComponent: () => {
    const { orgUrlSlug } = Route.useParams()
    return <NotFoundView entity="organization" entityIdentifier={orgUrlSlug} />
  },
})
