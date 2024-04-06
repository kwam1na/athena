export const formatServiceForClient = (service: any, storeCurrency = 'usd') => {
   return {
      id: service.id,
      is_archived: service.is_archived,
      currency: storeCurrency,
      name: service.name,
      price: service.price,
      start_time: service.start_time,
      end_time: service.end_time,
      interval_type: service.interval_type,
      appointments: [], // Assuming appointments should be an empty array initially
   };
};
