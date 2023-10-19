import React from 'react';
import { Progress } from './progress';

interface ProgressItemProps {
   title: string;
   percentage: number;
}

export const ProgressItem: React.FC<ProgressItemProps> = ({
   title,
   percentage,
}) => (
   <div className="flex flex-col gap-4">
      <div className="flex justify-between">
         <span className="text-sm">{title}</span>
         <span className="ml-2 text-sm">{percentage}%</span>
      </div>
      <Progress className="bg-card" value={percentage} />
   </div>
);
