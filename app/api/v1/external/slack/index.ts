export const sendSlackMessage = async (appointmentInfo: {
   customerName: string;
   date: string;
}) => {
   const webhookUrl =
      'https://hooks.slack.com/services/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';
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
