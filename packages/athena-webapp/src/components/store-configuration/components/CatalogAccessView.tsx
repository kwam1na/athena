import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";
import View from "../../View";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { ActionModal } from "../../ui/modals/action-modal";

type TokenRow = {
  tokenId: Id<"catalogAccessToken">;
  label: string;
  status: "active" | "revoked";
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

function formatInstant(value?: number) {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const CatalogAccessView = () => {
  const { activeStore } = useGetActiveStore();
  const storeId = activeStore?._id as Id<"store"> | undefined;

  const tokens = useQuery(
    api.inventory.catalogAccess.list,
    storeId ? { storeId } : "skip",
  ) as TokenRow[] | undefined;
  const mint = useMutation(api.inventory.catalogAccess.mint);
  const revoke = useMutation(api.inventory.catalogAccess.revoke);

  const [label, setLabel] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<TokenRow | null>(null);

  const handleMint = async () => {
    if (!storeId) return;
    setIsBusy(true);
    try {
      const result = await runCommand(() => mint({ storeId, label }));
      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }
      // The only time this value exists. It is not stored anywhere the
      // operator can read it again.
      setMintedToken(result.data.token);
      setLabel("");
    } finally {
      setIsBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!storeId || !pendingRevoke) return;
    setIsBusy(true);
    try {
      const result = await runCommand(() =>
        revoke({ storeId, tokenId: pendingRevoke.tokenId }),
      );
      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }
      toast.success("Token revoked.", { position: "top-right" });
      setPendingRevoke(null);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <View
      className="w-full lg:col-span-2"
      fullHeight={false}
      hideBorder
      hideHeaderBottomBorder
      lockDocumentScroll={false}
      header={<p className="text-sm text-muted-foreground">Catalogue access</p>}
    >
      <div className="container mx-auto space-y-4 py-8">
        <p className="text-xs text-muted-foreground">
          Tokens let an approved integration read this store&apos;s public
          catalogue. A token is shown once, when you create it.
        </p>

        {mintedToken && (
          <div
            className="space-y-2 rounded-md border border-border bg-muted p-3"
            data-testid="catalog-access-minted-token"
            role="status"
          >
            <p className="text-xs text-muted-foreground">
              Copy this token now — it will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-xs">
                {mintedToken}
              </code>
              <Button
                aria-label="Copy token"
                onClick={async () => {
                  await navigator.clipboard.writeText(mintedToken);
                  toast.success("Token copied.", { position: "top-right" });
                }}
                size="icon"
                variant="ghost"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button
              onClick={() => setMintedToken(null)}
              size="sm"
              variant="ghost"
            >
              Done
            </Button>
          </div>
        )}

        <ul className="divide-y divide-border">
          {(tokens ?? []).map((token) => (
            <li
              className="flex items-center justify-between gap-4 py-2"
              data-testid={`catalog-access-token-${token.tokenId}`}
              key={token.tokenId}
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  {token.label}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {`Created ${formatInstant(token.createdAt)} · Last used ${formatInstant(token.lastUsedAt)} · ${token.status === "active" ? "Active" : "Revoked"}`}
                </p>
              </div>
              {token.status === "active" && (
                <Button
                  aria-label={`Revoke ${token.label}`}
                  disabled={isBusy}
                  onClick={() => setPendingRevoke(token)}
                  size="sm"
                  variant="ghost"
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
          {tokens?.length === 0 && (
            <li className="py-2 text-xs text-muted-foreground">
              No tokens yet.
            </li>
          )}
        </ul>

        <div className="flex items-center gap-2">
          <Input
            aria-label="Token name"
            disabled={isBusy}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Token name"
            value={label}
          />
          <LoadingButton
            disabled={!storeId || label.trim().length === 0}
            isLoading={isBusy}
            onClick={handleMint}
            variant="outline"
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Create token
          </LoadingButton>
        </div>
      </div>

      {pendingRevoke && (
        <ActionModal
          confirmText="Revoke token"
          ctaButtonVariant="destructive"
          description={`${pendingRevoke.label} stops working immediately. Anything using it will need a new token.`}
          isOpen
          loading={isBusy}
          onClose={() => setPendingRevoke(null)}
          onConfirm={handleRevoke}
          title="Revoke this token?"
        />
      )}
    </View>
  );
};
