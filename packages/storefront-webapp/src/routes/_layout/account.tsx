import { getActiveUser, updateUser } from "@/api/storeFrontUser";
import { FadeIn } from "@/components/common/FadeIn";
import { CustomerDetailsForm } from "@/components/common/forms/CustomerDetailsForm";
import { DeliveryDetailsForm } from "@/components/common/forms/DeliveryDetailsForm";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { useLogout } from "@/hooks/useLogout";
import {
  LOGGED_IN_USER_ID_KEY,
  OG_ORGANIZTION_ID,
  OG_STORE_ID,
} from "@/lib/constants";
import { ALL_COUNTRIES } from "@/lib/countries";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";
import { StoreFrontUser } from "@athena/webapp";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_layout/account")({
  beforeLoad: async () => {
    const id = localStorage.getItem(LOGGED_IN_USER_ID_KEY);

    if (!id) return redirect({ to: "/login" });

    try {
      await getActiveUser({
        storeId: OG_STORE_ID,
        organizationId: OG_ORGANIZTION_ID,
        userId: id || "",
      });
    } catch (e) {
      return redirect({ to: "/login" });
    }
  },

  component: () => <Account />,
});

interface Address {
  address: string;
  city: string;
  zip?: string;
  state?: string;
  region?: string;
  country: string;
}

const AddressSection = ({
  type,
  user,
  address,
}: {
  type: "shipping" | "billing";
  user?: StoreFrontUser;
  address: Address;
}) => {
  const [isEditing, setIsEditing] = useState(false);

  const [updatedAddress, setUpdatedAddress] = useState<Address | null>(null);

  const { store, userId } = useStoreContext();

  const handleOnSubmitForm = async (data: any) => {
    const addressType =
      type === "shipping" ? "shippingAddress" : "billingAddress";

    const update = { [addressType]: data };

    const res = await updateUser({
      data: update,
      storeId: store?._id as string,
      userId: userId || "",
      organizationId: store?.organizationId as string,
    });

    if (res?.[addressType]) {
      setUpdatedAddress(res[addressType]);
    }
  };

  const title = type === "shipping" ? "Shipping address" : "Billing address";

  if (isEditing) {
    return (
      <DeliveryDetailsForm
        defaultValues={address}
        title={title}
        onCancelClick={() => setIsEditing(false)}
        onSubmitClick={handleOnSubmitForm}
      />
    );
  }

  const addr = updatedAddress || address;

  const isUSAddress = addr?.country === "US";

  const country = ALL_COUNTRIES.find((c) => c.code === addr?.country)?.name;

  const region = GHANA_REGIONS.find((r) => r.code === addr?.region)?.name;

  return (
    <div className="space-y-2">
      <p className="font-medium">{title}</p>

      {addr && (
        <>
          {user?.firstName && user?.lastName && (
            <p className="text-sm">{`${user?.firstName} ${user?.lastName}`}</p>
          )}
          <p className="text-sm">{addr?.address}</p>
          {isUSAddress && (
            <p className="text-sm">{`${addr?.city}, ${addr?.state} ${addr?.zip}`}</p>
          )}
          {!isUSAddress && <p className="text-sm">{addr?.city}</p>}
          {region && <p className="text-sm">{region}</p>}
          <p className="text-sm">{country}</p>
        </>
      )}

      <Button className="p-0" variant="link" onClick={() => setIsEditing(true)}>
        <p className="text-sm">{addr ? "Edit" : "Update"}</p>
      </Button>
    </div>
  );
};

const ContactSection = ({ user }: { user?: StoreFrontUser }) => {
  const { store, userId } = useStoreContext();

  const [userDetails, setUserDetails] = useState<StoreFrontUser>();

  const [isEditing, setIsEditing] = useState(false);

  const queryClient = useQueryClient();

  const handleOnSubmitForm = async (data: any) => {
    const res = await updateUser({
      data: { ...data },
      storeId: store?._id as string,
      userId: userId || "",
      organizationId: store?.organizationId as string,
    });

    if (res) {
      setUserDetails(res);
    }

    queryClient.invalidateQueries({ queryKey: ["user"] });
  };

  useEffect(() => {
    if (user) {
      setUserDetails(user);
    }
  }, [user]);

  if (isEditing) {
    return (
      <CustomerDetailsForm
        onSubmitClick={handleOnSubmitForm}
        defaultValues={userDetails}
        onCancelClick={() => setIsEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="font-medium">Contact information</p>
      {userDetails?.firstName && userDetails?.lastName && (
        <p className="text-sm">{`${userDetails?.firstName} ${userDetails?.lastName}`}</p>
      )}
      <p className="text-sm">{userDetails?.email}</p>
      <p className="text-sm">{userDetails?.phoneNumber}</p>

      <Button className="p-0" variant="link" onClick={() => setIsEditing(true)}>
        <p className="text-sm">Edit</p>
      </Button>
    </div>
  );
};

const Account = () => {
  const handleLogout = useLogout();

  const { user } = useStoreContext();

  return (
    <FadeIn className="min-h-screen space-y-8 lg:space-y-24 pb-56">
      <div className="space-y-8">
        <div className="w-full bg-[#F6F6F6]">
          <div className="container mx-auto max-w-[1024px] space-y-4">
            <div className="flex items-center border-b py-2 px-6 lg:px-0">
              <p className="text-lg font-medium">Account</p>

              <Button
                className="ml-auto p-0"
                variant={"link"}
                onClick={handleLogout}
              >
                <p>Sign out</p>
              </Button>
            </div>

            <div className="px-6 lg:px-0">
              {user?.firstName ? (
                <p className="text-2xl font-medium pt-8 pb-4">{`Hi, ${user?.firstName}.`}</p>
              ) : (
                <p className="text-2xl font-medium pt-8 pb-4">Hi there.</p>
              )}
            </div>
          </div>
        </div>

        <div className="container mx-auto max-w-[1024px] space-y-16 px-6 lg:px-0">
          <p className="text-lg font-medium">Account Details</p>

          <div className="space-y-16">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-40">
              <p className="font-medium text-md">Shipping</p>

              <AddressSection
                type="shipping"
                user={user}
                address={user?.shippingAddress as Address}
              />

              <ContactSection user={user} />

              {/* <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
                
              </div> */}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-40">
              <p className="font-medium text-md">Payment</p>

              <AddressSection
                type="billing"
                user={user}
                address={user?.billingAddress as Address}
              />
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
};
