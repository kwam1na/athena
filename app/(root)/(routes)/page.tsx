'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';

import { useStoreModal } from '@/hooks/use-store-modal';

const SetupPage = () => {
   const onOpen = useStoreModal((state) => state.onOpen);
   const isOpen = useStoreModal((state) => state.isOpen);

   console.log('[page in root] beginning ops..');

   //    useEffect(() => {
   //       const fetchUserData = async () => {
   //          console.log('[page in root] fetching refresh');
   //          try {
   //             const response = await fetch('/api/refresh-token');
   //             const res = await response.json();
   //             // console.log('[page in root] refresh response:', res);
   //          } catch (error) {
   //             console.log('[page in root] error:', (error as Error).message);
   //          }
   //       };

   //       fetchUserData();
   //    }, []);

   useEffect(() => {
      if (!isOpen) {
         onOpen();
      }
   }, [isOpen, onOpen]);

   return null;
};

export default SetupPage;
