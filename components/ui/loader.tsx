'use client';

import { useTheme } from 'next-themes';
import { ClipLoader, BounceLoader, PuffLoader } from 'react-spinners';

export const Loader = () => {
   const { theme } = useTheme();
   return (
      <PuffLoader color={theme === 'dark' ? '#2D2D2D' : ' #D3D3D3'} size={50} />
   );
};
