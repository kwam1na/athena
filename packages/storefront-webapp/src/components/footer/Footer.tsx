import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { useGetStoreCategories } from "../navigation/hooks";
import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { getStoreConfigV2 } from "@/lib/storeConfig";

type FooterLinkGroup = {
  heading: string;
  links: ReactNode[];
};

function LinkGroup({ group }: { group: FooterLinkGroup }) {
  return (
    <section aria-labelledby={`footer-${group.heading.toLowerCase()}`}>
      <h2
        id={`footer-${group.heading.toLowerCase()}`}
        className="font-medium"
      >
        {group.heading}
      </h2>
      <ul className="mt-layout-md space-y-layout-xs">
        {group.links.map((link, index) => (
          <li key={index}>{link}</li>
        ))}
      </ul>
    </section>
  );
}

export function FooterInner({
  categories,
}: {
  categories?: Array<{ value: string; label: string }>;
}) {
  const { store } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);
  const externalProps = {
    target: "_blank",
    rel: "noopener noreferrer",
  } as const;
  const linkGroups: FooterLinkGroup[] = [
    {
      heading: "Shop",
      links:
        categories?.map((category) => (
          <Link
            key={category.value}
            to="/shop/$categorySlug"
            params={(params) => ({
              ...params,
              categorySlug: category.value,
            })}
          >
            {category.label}
          </Link>
        )) ?? [],
    },
    {
      heading: "Follow us",
      links: [
        <a href="https://www.instagram.com/wigclub/" {...externalProps}>
          Instagram
        </a>,
        <a href="https://www.tiktok.com/@wigclubshop" {...externalProps}>
          TikTok
        </a>,
        <a href="https://x.com/WigClub_" {...externalProps}>
          X
        </a>,
      ],
    },
    {
      heading: "Company",
      links: [<Link to="/contact-us">Contact us</Link>],
    },
    {
      heading: "Policies",
      links: [
        <Link to="/policies/privacy">Privacy policy</Link>,
        <Link to="/policies/delivery-returns-exchanges">
          Deliveries, returns and exchanges
        </Link>,
        <Link to="/policies/tos">Terms of service</Link>,
      ],
    },
  ];

  return (
    <footer className="mx-auto flex w-full max-w-content flex-col gap-layout-2xl px-gutter pb-layout-lg pt-layout-xl text-sm font-light">
      <div className="grid grid-cols-2 gap-layout-xl sm:grid-cols-4">
        {linkGroups.map((group) => (
          <LinkGroup key={group.heading} group={group} />
        ))}
      </div>
      <address className="not-italic">
        <p>{storeConfig.contact.location}</p>
        <a
          href={`tel:${storeConfig.contact.phoneNumber}`}
          className="mt-layout-xs inline-flex min-h-11 items-center font-medium hover:underline"
        >
          {storeConfig.contact.phoneNumber}
        </a>
      </address>
      <p className="text-xs font-medium text-muted-foreground">
        © {new Date().getFullYear()} {store?.name}. All rights reserved
      </p>
    </footer>
  );
}

const Footer = forwardRef<
  HTMLDivElement,
  {
    deferCategories?: boolean;
  }
>(({ deferCategories = false }, ref) => {
  const [categoriesEnabled, setCategoriesEnabled] = useState(!deferCategories);
  useEffect(() => {
    if (!deferCategories) {
      setCategoriesEnabled(true);
      return;
    }
    const enable = () => setCategoriesEnabled(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(enable, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(enable, 1500);
    return () => globalThis.clearTimeout(id);
  }, [deferCategories]);
  const { categories } = useGetStoreCategories({ enabled: categoriesEnabled });

  return (
    <div ref={ref} className="bg-surface-subtle">
      <FooterInner categories={categories} />
    </div>
  );
});

Footer.displayName = "Footer";
export default Footer;
