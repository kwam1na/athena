import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { useGetStoreCategories } from "../navigation/hooks";

interface FooterLinkGroup {
  header: string;
  links: React.ReactNode[];
}

function LinkGroup({ group }: { group: FooterLinkGroup }) {
  return (
    <ul className="space-y-4">
      <li>
        <p className="font-bold">{group.header}</p>
      </li>
      <ul className="space-y-2">
        {group.links.map((link, idx) => (
          <li key={idx}>{link}</li>
        ))}
      </ul>
    </ul>
  );
}

export default function Footer() {
  const { store } = useStoreContext();

  const { categories } = useGetStoreCategories();

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
        <a href="https://instagram.com">Instagram</a>,
        <a href="https://instagram.com">Tiktok</a>,
        <a href="https://instagram.com">X</a>,
      ],
    },
    {
      header: "Company",
      links: [<Link>About us</Link>, <Link>Contact us</Link>],
    },
    {
      header: "Policies",
      links: [
        <Link>Privacy policy</Link>,
        <Link>Delivery, returns and exchanges</Link>,
        <Link>Terms of service</Link>,
        <Link>FAQs</Link>,
      ],
    },
  ];

  return (
    <footer className="w-full flex flex-col gap-12 justify-center px-6 lg:px-16 pb-8 text-sm font-light">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
        {linkGroups.map((group, idx) => (
          <LinkGroup key={idx} group={group} />
        ))}
      </div>
      <div className="flex items-center justify-center w-full">
        <p>
          © {new Date().getFullYear()} {store?.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
