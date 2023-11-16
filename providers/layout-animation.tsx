'use client';

import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';

export const LayoutAnimation = ({
   children,
}: {
   children: React.ReactNode;
}) => {
   return (
      <motion.div variants={widgetVariants} initial="hidden" animate="visible">
         {children}
      </motion.div>
   );
};
