export const sendSlackMessage = async (appointmentInfo: {
   customerName: string;
   date: string;
}) => {
   const webhookUrl = process.env.SLACK_WEBHOOK_URL!;
   const message = {
      text: `New appointment booked for ${appointmentInfo.customerName} at ${appointmentInfo.date}.`,
   };

   await fetch(webhookUrl, {
      method: 'POST',
      headers: {
         'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
   });
};
