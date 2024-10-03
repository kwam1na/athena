import ProductView from '@/components/ProductView'
import { NotFoundView } from '@/components/states/not-found/NotFoundView'
import { getOrganization } from '@/server-actions/organizations'
import { getProductBySlug } from '@/server-actions/products'
import { getStore } from '@/server-actions/stores'
import { createFileRoute, notFound } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_authed/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug',
)({
  loader: async ({ params: { orgUrlSlug, storeUrlSlug, productSlug } }) => {
    const [org, store, product] = await Promise.all([
      getOrganization(orgUrlSlug),
      getStore(storeUrlSlug),
      getProductBySlug(productSlug),
    ])

    if (!org || !store || !product)
      throw notFound({
        data: {
          store: Boolean(store) == false,
          org: Boolean(org) == false,
          product: Boolean(product) == false,
        },
      })

    return {
      product,
      store,
      org,
    }
  },

  component: ProductView,

  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug, productSlug } = Route.useParams()
    const { data: d } = data as Record<string, any>
    const { org, store } = d as Record<string, boolean>

    const entity = org ? 'organization' : store ? 'store' : 'product'
    const name = org ? orgUrlSlug : store ? storeUrlSlug : productSlug

    return <NotFoundView entity={entity} entityIdentifier={name} />
  },
})
