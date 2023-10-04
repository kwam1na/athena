'use client';

import * as React from 'react';

import { Calendar } from '@/components/ui/calendar';

interface CalendarDatePickerProps {
   date?: Date;
   setDate: React.Dispatch<React.SetStateAction<Date | undefined>>;
}

export const CalendarDatePicker: React.FC<CalendarDatePickerProps> = ({
   date,
   setDate,
}) => {
   return (
      <Calendar
         mode="single"
         selected={date}
         onSelect={setDate}
         className="rounded-md border"
      />
   );
};
