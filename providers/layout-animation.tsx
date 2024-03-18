'use client';

import { motion } from 'framer-motion';
import { fadeInAnimation } from '@/lib/constants';

export const LayoutAnimation = ({
   children,
}: {
   children: React.ReactNode;
}) => {
   return (
      <motion.div variants={fadeInAnimation} initial="hidden" animate="visible">
         {children}
      </motion.div>
   );
};
