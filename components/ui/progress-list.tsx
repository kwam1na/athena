import React from 'react';
import { ProgressItem } from './progess-item';

export interface ProgressData {
   title: string;
   percentage: number;
}

interface ProgressListProps {
   data: ProgressData[];
   header?: string;
   seeAllLink?: string;
}

export const ProgressList: React.FC<ProgressListProps> = ({
   data,
   header,
   seeAllLink,
}) => (
   <div className="p-4 space-y-8">
      {header && (
         <div className="flex justify-between mb-4">
            <span className="text-md">{header}</span>
            {seeAllLink && <a href={seeAllLink}>See All</a>}
         </div>
      )}
      <div className="space-y-8">
         {data.map((item, index) => (
            <ProgressItem
               key={index}
               title={item.title}
               percentage={item.percentage}
            />
         ))}
      </div>
   </div>
);
