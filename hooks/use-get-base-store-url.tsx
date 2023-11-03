'use client';

import { useParams } from 'next/navigation';

function useGetBaseStoreUrl() {
   const params = useParams();
   return `/organizations/${params.organizationId}/store/${params.storeId}`;
}

export default useGetBaseStoreUrl;
