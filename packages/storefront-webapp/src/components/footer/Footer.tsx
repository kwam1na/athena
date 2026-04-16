import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { useGetStoreCategories } from "../navigation/hooks";
import { forwardRef, useEffect, useState } from "react";
import { getStoreConfigV2 } from "@/lib/storeConfig";

interface FooterLinkGroup {
  header: string;
  links: React.ReactNode[];
}

function LinkGroup({ group }: { group: FooterLinkGroup }) {
  return (
    <ul className="space-y-4">
      <li>
        <p className="font-medium">{group.header}</p>
      </li>
      <ul className="space-y-2">
        {group.links.map((link, idx) => (
          <li key={idx}>{link}</li>
        ))}
      </ul>
    </ul>
  );
}

export function FooterInner({
  categories,
}: {
  categories?: Array<{ value: string; label: string }>;
}) {
  const { store } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);

  const storeLinks = categories?.map((s) => (
    <Link
      key={s.value}
      to="/shop/$categorySlug"
      params={(p) => ({
        ...p,
        categorySlug: s.value,
      })}
    >
      {s.label}
    </Link>
  ));

  const linkGroups: FooterLinkGroup[] = [
    {
      header: "Shop",
      links: storeLinks || [],
    },
    {
      header: "Follow us",
      links: [
        <a href="https://www.instagram.com/wigclub/" target="_blank">
          Instagram
        </a>,
        <a href="https://www.tiktok.com/@wigclubshop" target="_blank">
          Tiktok
        </a>,
        <a href="https://x.com/WigClub_" target="_blank">
          X
        </a>,
      ],
    },
    {
      header: "Company",
      links: [
        // <Link>About us</Link>,
        <Link to="/contact-us">Contact us</Link>,
      ],
    },
    {
      header: "Policies",
      links: [
        <Link to="/policies/privacy">Privacy policy</Link>,
        <Link to="/policies/delivery-returns-exchanges">
          Deliveries, returns and exchanges
        </Link>,
        <Link to="/policies/tos">Terms of service</Link>,
        // <Link>FAQs</Link>,
      ],
    },
  ];

  return (
    <footer className="container mx-auto max-w-[1024px] flex flex-col gap-24 justify-center pb-8 text-sm font-light">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-12">
        {linkGroups.map((group, idx) => (
          <LinkGroup key={idx} group={group} />
        ))}
      </div>

      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <p>{storeConfig.contact.location}</p>
          <div>
            <a
              href={`tel:${storeConfig.contact.phoneNumber}`}
              className="hover:underline font-medium"
            >
              {storeConfig.contact.phoneNumber}
            </a>
          </div>
        </div>
      </div>
      <div className="flex items-center w-full text-xs font-medium text-muted-foreground">
        <p>
          © {new Date().getFullYear()} {store?.name}. All rights reserved
        </p>
      </div>
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

    const enableCategories = () => {
      setCategoriesEnabled(true);
    };

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(enableCategories, {
        timeout: 1500,
      });

      return () => {
        window.cancelIdleCallback(idleId);
      };
    }

    const timeoutId = globalThis.setTimeout(enableCategories, 1500);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [deferCategories]);

  const { categories } = useGetStoreCategories({
    enabled: categoriesEnabled,
  });

  return (
    <div ref={ref} className="pt-8 bg-accent5">
      <div className="container mx-auto max-w-[1024px] px-6 lg:px-0">
        <FooterInner categories={categories} />
      </div>
    </div>
  );
});

Footer.displayName = "Footer";

export default Footer;
