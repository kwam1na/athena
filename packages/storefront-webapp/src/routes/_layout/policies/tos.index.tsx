import { FadeIn } from "@/components/common/FadeIn";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/policies/tos/")({
  component: () => <TOS />,
});

type TosSectionProps = {
  sectionNumber: number;
  sectionTitle: string;
  sectionItems: string[] | React.ReactNode[];
};

const TosSection = ({
  sectionNumber,
  sectionTitle,
  sectionItems,
}: TosSectionProps) => {
  return (
    <div className="space-y-4">
      <div className="text-md font-medium">{`${sectionNumber}. ${sectionTitle}`}</div>
      <div className="space-y-2">
        {sectionItems.map((item, idx) => (
          <div key={idx}>{item}</div>
        ))}
      </div>
    </div>
  );
};

const TOS = () => {
  const tosSections: TosSectionProps[] = [
    {
      sectionNumber: 1,
      sectionTitle: "General Use",
      sectionItems: [
        "This website is provided for your personal and non-commercial use.",
        "By using the site, you agree to comply with all applicable laws and regulations.",
        "We reserve the right to modify these Terms of Service at any time. Continued use of the site after changes are posted constitutes your acceptance of the modified terms.",
      ],
    },
    {
      sectionNumber: 2,
      sectionTitle: "User Accounts",
      sectionItems: [
        "You may be required to create an account to access certain features of the site.",
        "You are responsible for maintaining the confidentiality of your account information and for all activities under your account.",
        "You agree to notify us immediately of any unauthorized use of your account.",
        "We reserve the right to suspend or terminate accounts that violate these terms or engage in fraudulent activity.",
      ],
    },
    {
      sectionNumber: 3,
      sectionTitle: "Product Information",
      sectionItems: [
        "We make every effort to provide accurate product information, but we do not guarantee the accuracy, completeness, or reliability of the information on the site.",
        "Product descriptions and images are for informational purposes only and may not be an exact representation of the product.",
        "We reserve the right to correct any errors, inaccuracies, or omissions and to change or update information at any time without prior notice.",
      ],
    },
    {
      sectionNumber: 4,
      sectionTitle: "Intellectual Property",
      sectionItems: [
        "All content on this site, including text, images, logos, and software, is the property of the site owner and is protected by copyright.",
        "You may not reproduce, distribute, or modify any content from this site without our prior written consent.",
        "You may not use any trademarks, service marks, or logos displayed on the site without our permission.",
      ],
    },
    {
      sectionNumber: 5,
      sectionTitle: "Purchase Terms",
      sectionItems: [
        <div className="flex flex-wrap items-center gap-1">
          <div>All purchases made through the site are subject to our</div>
          <Link to="/policies/delivery-returns-exchanges" className="underline">
            exchange, return and refund policies.
          </Link>
        </div>,
        "Prices are subject to change without notice.",
        "We reserve the right to refuse or cancel any order for any reason at any time.",
      ],
    },
    {
      sectionNumber: 6,
      sectionTitle: "User Conduct",
      sectionItems: [
        "You agree not to use the site for any unlawful or prohibited purpose.",
        "You may not upload, post, or transmit any content that is harmful, threatening, abusive, defamatory, or otherwise objectionable.",
        "You may not interfere with the operation of the site or attempt to gain unauthorized access to any part of the site.",
      ],
    },
    {
      sectionNumber: 7,
      sectionTitle: "Limitation of Liability",
      sectionItems: [
        "We are not liable for any direct, indirect, incidental, special, or consequential damages arising out of your use of the site or any products purchased through the site.",
        "In no event shall our liability exceed the total amount paid by you for the product or service in question.",
        "This limitation of liability applies to the fullest extent permitted by law.",
        "We do not guarantee that the site will be error-free, secure, or uninterrupted.",
      ],
    },
    {
      sectionNumber: 8,
      sectionTitle: "Links to Third-Party Sites",
      sectionItems: [
        "This site may contain links to third-party websites that are not owned or operated by us.",
        "We are not responsible for the content or privacy practices of these sites.",
        "We recommend that you review the terms and conditions and privacy policy of any third-party site you visit.",
      ],
    },
    {
      sectionNumber: 9,
      sectionTitle: "Indemnification",
      sectionItems: [
        "You agree to indemnify and hold harmless the site owner, its affiliates, and their respective officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses arising out of your use of the site or violation of these terms.",
      ],
    },
    {
      sectionNumber: 10,
      sectionTitle: "Governing Law",
      sectionItems: [
        "These Terms of Service are governed by the laws of Ghana.",
        "Any disputes arising from these terms shall be resolved in the courts located in Ghana.",
      ],
    },
    {
      sectionNumber: 11,
      sectionTitle: "Contact Us",
      sectionItems: [
        "If you have any questions about these Terms of Service, please contact us at support@wigclub.store",
      ],
    },
  ];

  return (
    <FadeIn className="container mx-auto max-w-[1024px] pb-56 py-8 px-6 xl:px-0">
      <div className="space-y-8">
        <h1 className="text-lg">Terms of Service</h1>

        <p className="text-sm">
          By accessing and using this site, you agree to the following terms and
          conditions. Please read them carefully, as they govern your use of our
          site and services.
        </p>
        <div className="space-y-8 text-sm">
          {tosSections.map((section) => (
            <TosSection
              key={section.sectionNumber}
              sectionNumber={section.sectionNumber}
              sectionTitle={section.sectionTitle}
              sectionItems={section.sectionItems}
            />
          ))}
        </div>
      </div>
    </FadeIn>
  );
};
