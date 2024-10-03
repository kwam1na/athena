import ProductsView from '@/components/ProductsView'
import { NotFoundView } from '@/components/states/not-found/NotFoundView'
import { getOrganization } from '@/server-actions/organizations'
import { getProducts } from '@/server-actions/products'
import { getStore } from '@/server-actions/stores'
import { createFileRoute, notFound } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_authed/$orgUrlSlug/store/$storeUrlSlug/products/',
)({
  loader: async ({ params: { orgUrlSlug, storeUrlSlug } }) => {
    const [org, store] = await Promise.all([
      getOrganization(orgUrlSlug),
      getStore(storeUrlSlug),
    ])

    if (!org || !store)
      throw notFound({
        data: {
          store: Boolean(store) == false,
          org: Boolean(org) == false,
        },
      })

    const products = await getProducts(store.id)

    return {
      products,
      org,
      store,
    }
  },

  component: ProductsView,

  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams()
    const { data: d } = data as Record<string, any>
    const { org } = d as Record<string, boolean>

    const entity = org ? 'organization' : 'store'
    const name = org ? orgUrlSlug : storeUrlSlug

    return <NotFoundView entity={entity} entityIdentifier={name} />
  },
})