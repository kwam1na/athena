export const defaultOptions: Record<string, any> = {
   method: 'GET',
   headers: {
      'Content-Type': 'application/json',
   },
};

export const currencies = [
   {
      label: 'US Dollar',
      value: 'usd',
   },
   {
      label: 'Ghanaian Cedi',
      value: 'ghs',
   },
];

// animation variants
export const mainContainerVariants = {
   hidden: {
      opacity: 0,
      y: 8,
   },
   visible: {
      opacity: 1,
      y: 0,
      transition: {
         type: 'easeIn',
         duration: 0.4,
      },
   },
};

export const fadeInAnimation = {
   hidden: {
      opacity: 0,
   },
   visible: {
      opacity: 1,
      transition: {
         type: 'easeIn',
         duration: 0.4,
      },
   },
};

export const containerVariants = {
   hidden: {
      opacity: 0,
      y: 16,
   },
   visible: {
      opacity: 1,
      y: 0,
      transition: {
         type: 'easeIn',
         duration: 0.4,
      },
   },
};

export const buttonVariants = {
   hidden: {
      opacity: 0,
      x: -24,
   },
   visible: {
      opacity: 1,
      x: 0,
      transition: {
         type: 'easeIn',
         duration: 0.5,
         delay: 0.6,
      },
   },
};

export const blurbVariants = {
   hidden: {
      opacity: 0,
      y: 8,
   },
   visible: {
      opacity: 1,
      y: 0,
      transition: {
         type: 'easeIn',
         duration: 0.4,
         delay: 0.6,
      },
   },
};

export const hours = [
   {
      value: '6:00 am',
      label: '6:00 am',
   },
   {
      value: '7:00 am',
      label: '7:00 am',
   },
   {
      value: '8:00 am',
      label: '8:00 am',
   },
   {
      value: '9:00 am',
      label: '9:00 am',
   },
   {
      value: '10:00 am',
      label: '10:00 am',
   },
   {
      value: '11:00 am',
      label: '11:00 am',
   },
   {
      value: '12:00 pm',
      label: '12:00 pm',
   },
   {
      value: '1:00 pm',
      label: '1:00 pm',
   },
   {
      value: '2:00 pm',
      label: '2:00 pm',
   },
   {
      value: '3:00 pm',
      label: '3:00 pm',
   },
   {
      value: '4:00 pm',
      label: '4:00 pm',
   },
   {
      value: '5:00 pm',
      label: '5:00 pm',
   },
   {
      value: '6:00 pm',
      label: '6:00 pm',
   },
   {
      value: '7:00 pm',
      label: '7:00 pm',
   },
   {
      value: '8:00 pm',
      label: '8:00 pm',
   },
   {
      value: '9:00 pm',
      label: '9:00 pm',
   },
];

export const DEFAULT_SIDE_BAR_WIDTH = 20;
export const DEFAULT_MAIN_BODY_WIDTH = 80;

export const SIDE_BAR_WIDTH_COLLAPSED = 5;
export const SIDE_BAR_WIDTH_EXPANDED = 20;

export const MAIN_BODY_WIDTH_COLLAPSED = 95;
export const MAIN_BODY_WIDTH_EXPANDED = 80;
