export interface SideNavRoute {
   href: string;
   label: string;
   aliases?: string[];
   secondaryLabel?: string;
   icon?: React.ReactNode;
}

export type Service = {
   id: string;
   name: string;
   price: number;
   currency: string;
   start_time: string;
   end_time: string;
   interval_type: string;
   appointments: Appointment[];
};

export type StoreLocation = {
   street_address: string;
   city: string;
   country: string;
};

export type BusinessHour = {
   day: string;
   open_time: string;
   close_time: string;
   is_closed: boolean;
};

export type BusinessHours = BusinessHour[];

export type Store = {
   currency?: string;
   name?: string;
   store_hours: BusinessHours;
   store_location: StoreLocation;
};

export type AppointmentStatus =
   | 'pending'
   | 'in-progress'
   | 'ended'
   | 'canceled';

export type Appointment = {
   id: string;
   check_in_time: Date | null;
   end_time: Date | null;
   canceled_at_time: Date | null;
   customer: CustomerDetails;
   time_slot: string;
   date: Date;
   service_id: string;
   service?: Service;
   status: AppointmentStatus;
   store?: {
      store_location: StoreLocation;
   };
};

export type CustomerDetails = {
   id?: string;
   first_name?: string;
   last_name?: string;
   email?: string;
   phone_number?: string;
};
