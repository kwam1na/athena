import { useEffect, useMemo, useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import {
  StoreMtnMomoReceivingAccount,
  StoreMtnMomoSetupStatus,
} from "~/types";
import View from "../../View";
import { Button } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { LoadingButton } from "../../ui/loading-button";
import { Badge } from "../../ui/badge";
import { useStoreConfigUpdate } from "../hooks/useStoreConfigUpdate";

const MTN_MOMO_STATUS_LABELS: Record<StoreMtnMomoSetupStatus, string> = {
  not_configured: "Not configured",
  submitted: "Submitted",
  under_review: "Under review",
  connected: "Connected",
  needs_attention: "Needs attention",
};

const cloneReceivingAccount = (
  account: StoreMtnMomoReceivingAccount,
): StoreMtnMomoReceivingAccount => ({
  ...account,
  status: account.status ?? "not_configured",
  isPrimary: account.isPrimary === true,
});

const createEmptyReceivingAccount = (
  isPrimary = false,
): StoreMtnMomoReceivingAccount => ({
  label: "",
  walletNumber: "",
  businessName: "",
  market: "",
  businessContact: "",
  isPrimary,
  status: "not_configured",
});

const trimToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const cleanUndefinedFields = <T extends Record<string, any>>(value: T): T => {
  const nextValue = { ...value };

  for (const [key, fieldValue] of Object.entries(nextValue)) {
    if (fieldValue === undefined) {
      delete nextValue[key as keyof T];
    }
  }

  return nextValue;
};

const hasReceivingAccountDetails = (
  account: StoreMtnMomoReceivingAccount,
): boolean => {
  return Boolean(
    trimToUndefined(account.label) ||
      trimToUndefined(account.walletNumber) ||
      trimToUndefined(account.businessName) ||
      trimToUndefined(account.market) ||
      trimToUndefined(account.businessContact) ||
      trimToUndefined(account.statusNote),
  );
};

const normalizePrimaryAccounts = (
  accounts: StoreMtnMomoReceivingAccount[],
): StoreMtnMomoReceivingAccount[] => {
  let hasPrimaryAccount = false;

  return accounts.map((account) => {
    const isPrimary = account.isPrimary === true && !hasPrimaryAccount;
    hasPrimaryAccount = hasPrimaryAccount || isPrimary;

    return {
      ...account,
      isPrimary,
    };
  });
};

const toPatchReceivingAccounts = (
  accounts: StoreMtnMomoReceivingAccount[],
): StoreMtnMomoReceivingAccount[] => {
  const nextAccounts = accounts
    .map((account) =>
      cleanUndefinedFields({
        label: trimToUndefined(account.label),
        walletNumber: trimToUndefined(account.walletNumber),
        businessName: trimToUndefined(account.businessName),
        market: trimToUndefined(account.market),
        businessContact: trimToUndefined(account.businessContact),
        isPrimary: account.isPrimary === true,
        status: account.status ?? "not_configured",
        statusNote: trimToUndefined(account.statusNote),
      }),
    )
    .filter(hasReceivingAccountDetails);

  return normalizePrimaryAccounts(nextAccounts);
};

const getStatusBadgeVariant = (status: StoreMtnMomoSetupStatus) => {
  switch (status) {
    case "connected":
      return "default";
    case "needs_attention":
      return "destructive";
    default:
      return "secondary";
  }
};

export const MtnMomoView = () => {
  const { activeStore } = useGetActiveStore();
  const { updateConfig, isUpdating } = useStoreConfigUpdate();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [accounts, setAccounts] = useState<StoreMtnMomoReceivingAccount[]>([]);

  useEffect(() => {
    setAccounts(
      storeConfig.payments.mtnMomo.receivingAccounts.map(cloneReceivingAccount),
    );
  }, [storeConfig]);

  const updateAccount = (
    index: number,
    patch: Partial<StoreMtnMomoReceivingAccount>,
  ) => {
    setAccounts((currentAccounts) =>
      currentAccounts.map((account, accountIndex) =>
        accountIndex === index ? { ...account, ...patch } : account,
      ),
    );
  };

  const handleAddAccount = () => {
    setAccounts((currentAccounts) => [
      ...currentAccounts,
      createEmptyReceivingAccount(currentAccounts.length === 0),
    ]);
  };

  const handleMakePrimary = (index: number) => {
    setAccounts((currentAccounts) =>
      currentAccounts.map((account, accountIndex) => ({
        ...account,
        isPrimary: accountIndex === index,
      })),
    );
  };

  const handleRemoveAccount = (index: number) => {
    setAccounts((currentAccounts) => {
      const nextAccounts = currentAccounts.filter(
        (_, accountIndex) => accountIndex !== index,
      );

      if (
        nextAccounts.length > 0 &&
        !nextAccounts.some((account) => account.isPrimary)
      ) {
        nextAccounts[0] = {
          ...nextAccounts[0],
          isPrimary: true,
        };
      }

      return nextAccounts;
    });
  };

  const handleSave = async () => {
    const nextAccounts = toPatchReceivingAccounts(accounts);

    if (
      nextAccounts.length > 0 &&
      !nextAccounts.some((account) => account.isPrimary)
    ) {
      toast.error("Select a primary MTN account before saving.");
      return;
    }

    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        payments: {
          mtnMomo: {
            receivingAccounts: nextAccounts,
          },
        },
      },
      successMessage: "MTN MoMo settings updated",
      errorMessage: "An error occurred while updating MTN MoMo settings",
    });
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-muted-foreground">MTN MoMo setup</p>}
    >
      <div className="container mx-auto space-y-6 py-8">
        <p className="text-sm text-muted-foreground">
          Collect the merchant-facing details Athena needs for MTN onboarding.
          Developer credentials stay outside this form.
        </p>

        {accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6">
            <p className="text-sm text-muted-foreground">
              No MTN receiving accounts added yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {accounts.map((account, index) => {
              const accountTitle =
                account.label?.trim() || `Receiving account ${index + 1}`;

              return (
                <Card key={index}>
                  <CardHeader className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <CardTitle className="text-base">{accountTitle}</CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getStatusBadgeVariant(account.status)}>
                            {MTN_MOMO_STATUS_LABELS[account.status]}
                          </Badge>
                          {account.isPrimary && (
                            <Badge variant="outline">Primary</Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={account.isPrimary ? "secondary" : "outline"}
                          onClick={() => handleMakePrimary(index)}
                          aria-label={`Make account ${index + 1} primary`}
                          disabled={account.isPrimary}
                        >
                          <ShieldCheck className="h-4 w-4" />
                          {account.isPrimary ? "Primary account" : "Make primary"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleRemoveAccount(index)}
                          aria-label={`Remove account ${index + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`mtn-label-${index}`}>Account label</Label>
                      <Input
                        id={`mtn-label-${index}`}
                        value={account.label || ""}
                        onChange={(event) =>
                          updateAccount(index, { label: event.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`mtn-wallet-${index}`}>
                        MTN merchant wallet or account number
                      </Label>
                      <Input
                        id={`mtn-wallet-${index}`}
                        value={account.walletNumber || ""}
                        onChange={(event) =>
                          updateAccount(index, { walletNumber: event.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`mtn-business-name-${index}`}>
                        MTN account or business name
                      </Label>
                      <Input
                        id={`mtn-business-name-${index}`}
                        value={account.businessName || ""}
                        onChange={(event) =>
                          updateAccount(index, { businessName: event.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`mtn-market-${index}`}>
                        MTN market or country
                      </Label>
                      <Input
                        id={`mtn-market-${index}`}
                        value={account.market || ""}
                        onChange={(event) =>
                          updateAccount(index, { market: event.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor={`mtn-business-contact-${index}`}>
                        Business contact for follow-up
                      </Label>
                      <Input
                        id={`mtn-business-contact-${index}`}
                        value={account.businessContact || ""}
                        onChange={(event) =>
                          updateAccount(index, {
                            businessContact: event.target.value,
                          })
                        }
                      />
                    </div>

                    {account.statusNote && (
                      <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground md:col-span-2">
                        {account.statusNote}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={handleAddAccount}>
            <Plus className="h-4 w-4" />
            Add MTN account
          </Button>

          <LoadingButton
            isLoading={isUpdating}
            onClick={handleSave}
            aria-label="Save MTN MoMo settings"
          >
            Save
          </LoadingButton>
        </div>
      </div>
    </View>
  );
};
