# Email Templates

This directory contains all email templates for the Athena application, built using [React Email](https://react.email/).

## Available Templates

1. **VerificationCode.tsx** - Email verification code for user authentication
2. **OrderEmail.tsx** - Order confirmation and status update emails
3. **NewOrderAdmin.tsx** - Admin notification for new orders
4. **FeedbackRequest.tsx** - Product review request emails
5. **DiscountCode.tsx** - Promotional discount code announcements
6. **DiscountReminder.tsx** - Last chance discount reminder emails

## Development

### Preview Emails

To preview and develop email templates in your browser:

```bash
cd packages/athena-webapp
npm run email:dev
```

This will start the React Email development server at `http://localhost:3000` where you can:

- Preview all email templates
- Test responsive design
- See how emails render across different email clients
- Export HTML for testing

### Template Structure

Each email template:

- Uses React Email components (`Html`, `Head`, `Body`, `Container`, `Section`, `Text`, `Img`, `Button`, etc.)
- Accepts typed props matching the email parameters
- Returns both HTML and plain-text versions when rendered
- Supports responsive design out of the box

### Usage

Email templates are rendered in `convex/mailersend/index.tsx` using the `render` function:

```typescript
import { render } from "@react-email/components";
import VerificationCode from "../emails/VerificationCode";

const html = render(<VerificationCode {...params} />);
const text = render(<VerificationCode {...params} />, { plainText: true });
```

## Adding New Templates

1. Create a new `.tsx` file in this directory
2. Import React Email components
3. Define your props interface
4. Create your email component
5. Add inline styles using the React Email pattern
6. Import and use in `convex/mailersend/index.tsx`

Example:

```typescript
import { Body, Container, Head, Html, Text } from "@react-email/components";

interface MyEmailProps {
  userName: string;
}

export default function MyEmail({ userName }: MyEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Text style={paragraph}>Hello {userName}!</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#ffffff",
  fontFamily: 'Arial, sans-serif',
};

const container = {
  margin: "0 auto",
  maxWidth: "600px",
  padding: "20px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
};
```

## Best Practices

1. **Inline Styles**: Always use inline styles as CSS classes may not work in all email clients
2. **Responsive Design**: Test emails at different viewport sizes using the preview tool
3. **Plain Text**: Always provide a plain text version for better deliverability
4. **Image URLs**: Use absolute URLs for images (hosted on S3 or CDN)
5. **Font Stacks**: Use web-safe fonts (Arial, Helvetica, Georgia, etc.)
6. **Testing**: Test emails in multiple email clients (Gmail, Outlook, Apple Mail)

## Resources

- [React Email Documentation](https://react.email/docs/introduction)
- [React Email Components](https://react.email/docs/components/html)
- [Email Client Compatibility](https://www.caniemail.com/)
