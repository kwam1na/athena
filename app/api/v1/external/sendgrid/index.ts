export const sendMessage = async (appointmentDetails: {
   customerEmail?: string;
   customerName?: string;
   appointmentTime?: string;
   serviceName?: string;
   location?: string;
   storePhoneNumber?: string | null;
   senderName?: string | null;
   senderAddress?: string | null;
   senderCity?: string | null;
   senderCountry?: string | null;
}) => {
   const message = {
      from: {
         email: 'appointments@wigclub.store',
      },
      personalizations: [
         {
            to: [
               {
                  email: appointmentDetails.customerEmail,
               },
            ],
            dynamic_template_data: {
               customer_name: appointmentDetails.customerName,
               service_name: appointmentDetails.serviceName,
               appointment_date: appointmentDetails.appointmentTime,
               appointment_location: appointmentDetails.location,
               phone_number: appointmentDetails.storePhoneNumber,
               sender_name: appointmentDetails.senderName,
               sender_address: appointmentDetails.senderAddress,
               sender_city: appointmentDetails.senderCity,
               sender_country: appointmentDetails.senderCountry,
            },
         },
      ],
      template_id: 'd-1b2a1bbb87444ed3a0219ed29c9d0aa0',
   };

   await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
         'Content-Type': 'application/json',
         Authorization: `Bearer ${process.env.SENDGRID_API_KEY || ''}`,
      },
      body: JSON.stringify(message),
   });
};
