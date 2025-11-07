import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import CopyButton from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import View from "../../View";
import PageHeader, {
  ComposedPageHeader,
  SimplePageHeader,
  ViewHeader,
} from "../../common/PageHeader";
import { FadeIn } from "../../common/FadeIn";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import {
  BrowserInfo,
  BrowserFingerprintResult,
  generateBrowserFingerprint,
} from "@/lib/browserFingerprint";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "~/src/hooks/useAuth";

type TerminalStatus = "active" | "revoked" | "lost";

type TerminalRecord = {
  _id: Id<"posTerminal">;
  _creationTime: number;
  storeId: Id<"store">;
  fingerprintHash: string;
  displayName: string;
  registeredByUserId: Id<"athenaUser">;
  browserInfo: BrowserInfo;
  registeredAt: number;
  status: TerminalStatus;
};

type TerminalRowProps = {
  terminal: TerminalRecord;
  isBusy: boolean;
  onRename: (terminalId: Id<"posTerminal">, name: string) => Promise<void>;
  onChangeStatus: (
    terminalId: Id<"posTerminal">,
    status: TerminalStatus
  ) => Promise<void>;
  onDelete: (terminalId: Id<"posTerminal">) => Promise<void>;
};

function TerminalRow({
  terminal,
  isBusy,
  onRename,
  onChangeStatus,
  onDelete,
}: TerminalRowProps) {
  const [name, setName] = useState(terminal.displayName);
  const [isSavingName, setIsSavingName] = useState(false);

  useEffect(() => {
    setName(terminal.displayName);
  }, [terminal.displayName]);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === terminal.displayName) {
      return;
    }
    setIsSavingName(true);
    try {
      await onRename(terminal._id, name.trim());
      toast.success("Terminal name updated");
    } catch (error) {
      console.error(error);
      toast.error("Unable to update terminal name");
      setName(terminal.displayName);
    } finally {
      setIsSavingName(false);
    }
  };

  const statusVariant = {
    active: "default",
    revoked: "destructive",
    lost: "secondary",
  } as const;

  const browserMetadata: Array<{ label: string; value?: string | number }> = [
    { label: "Platform", value: terminal.browserInfo.platform },
    { label: "Language", value: terminal.browserInfo.language },
    { label: "Vendor", value: terminal.browserInfo.vendor },
    { label: "Resolution", value: terminal.browserInfo.screenResolution },
    { label: "Color Depth", value: terminal.browserInfo.colorDepth },
  ];

  return (
    <Card key={terminal._id} className="border border-dashed">
      <CardHeader className="gap-2 md:flex md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-xl">{terminal.displayName}</CardTitle>
          <CardDescription>
            Fingerprint hash uniquely identifies the browser instance
          </CardDescription>
        </div>
        <Badge variant={statusVariant[terminal.status]}>
          {terminal.status === "active"
            ? "Active"
            : terminal.status === "revoked"
              ? "Revoked"
              : "Lost"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">
              Browser Fingerprint
            </p>
            <p className="font-mono text-sm break-all">
              {terminal.fingerprintHash}
            </p>
          </div>
          <CopyButton stringToCopy={terminal.fingerprintHash} />
        </div>

        <Separator />

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${terminal._id}-name`}>Display name</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={`${terminal._id}-name`}
                value={name}
                disabled={isBusy && !isSavingName}
                onChange={(event) => setName(event.target.value)}
                placeholder="Front Counter Terminal"
              />
              <LoadingButton
                onClick={handleSaveName}
                disabled={
                  isBusy ||
                  !name.trim() ||
                  name.trim() === terminal.displayName ||
                  isSavingName
                }
                isLoading={isSavingName}
                variant="secondary"
              >
                Save name
              </LoadingButton>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              defaultValue={terminal.status}
              onValueChange={(nextStatus) =>
                onChangeStatus(terminal._id, nextStatus as TerminalStatus)
              }
              disabled={isBusy}
            >
              <SelectTrigger aria-label="Terminal status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <p className="text-xs uppercase text-muted-foreground">User ID</p>
            <p className="text-sm font-medium break-all">
              {terminal.registeredByUserId}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase text-muted-foreground">
              Registered
            </p>
            <p className="text-sm font-medium">
              {new Date(terminal.registeredAt).toLocaleString()}
            </p>
          </div>
          {browserMetadata
            .filter((item) => item.value !== undefined && item.value !== "")
            .map((item) => (
              <div key={item.label} className="space-y-1">
                <p className="text-xs uppercase text-muted-foreground">
                  {item.label}
                </p>
                <p className="text-sm font-medium break-all">{item.value}</p>
              </div>
            ))}
        </div>

        <Separator />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Remove the terminal to prevent any further POS access from this
            browser.
          </p>
          <Button
            variant="destructive"
            onClick={() => onDelete(terminal._id)}
            disabled={isBusy}
          >
            Delete terminal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function POSSettingsView() {
  const { activeStore } = useGetActiveStore();

  const { user: currentUser } = useAuth();

  const terminals = useQuery(
    api.inventory.posTerminal.listTerminals,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  ) as TerminalRecord[] | undefined;

  const registerTerminalMutation = useMutation(
    api.inventory.posTerminal.registerTerminal
  );
  const updateTerminalMutation = useMutation(
    api.inventory.posTerminal.updateTerminal
  );
  const deleteTerminalMutation = useMutation(
    api.inventory.posTerminal.deleteTerminal
  );

  const [fingerprintResult, setFingerprintResult] =
    useState<BrowserFingerprintResult | null>(null);
  const [fingerprintError, setFingerprintError] = useState<string | null>(null);
  const [isFingerprintLoading, setIsFingerprintLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isUpdatingExisting, setIsUpdatingExisting] = useState(false);
  const [busyTerminalIds, setBusyTerminalIds] = useState<
    Record<string, boolean>
  >({});

  const existingTerminal = useMemo(() => {
    if (!fingerprintResult || !terminals) return null;
    return (
      terminals.find(
        (terminal) =>
          terminal.fingerprintHash === fingerprintResult.fingerprintHash
      ) ?? null
    );
  }, [fingerprintResult, terminals]);

  useEffect(() => {
    if (nameTouched) {
      return;
    }
    if (existingTerminal) {
      setDisplayName(existingTerminal.displayName);
      return;
    }
  }, [existingTerminal, nameTouched]);

  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined") {
      return;
    }
    const generate = async () => {
      setIsFingerprintLoading(true);
      setFingerprintError(null);
      try {
        const result = await generateBrowserFingerprint();
        if (!cancelled) {
          setFingerprintResult(result);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setFingerprintError(
            error instanceof Error
              ? error.message
              : "Unable to generate fingerprint"
          );
        }
      } finally {
        if (!cancelled) {
          setIsFingerprintLoading(false);
        }
      }
    };

    generate();

    return () => {
      cancelled = true;
    };
  }, []);

  const markTerminalBusy = (terminalId: Id<"posTerminal">, busy: boolean) => {
    setBusyTerminalIds((prev) => ({
      ...prev,
      [terminalId]: busy,
    }));
  };

  const handleRefreshFingerprint = async () => {
    if (typeof window === "undefined") {
      toast.error("Browser fingerprinting is only available in the browser");
      return;
    }
    setIsFingerprintLoading(true);
    setFingerprintError(null);
    try {
      const result = await generateBrowserFingerprint();
      setFingerprintResult(result);
      toast.success("Fingerprint refreshed");
    } catch (error) {
      console.error(error);
      setFingerprintError(
        error instanceof Error
          ? error.message
          : "Unable to generate fingerprint"
      );
      toast.error("Unable to refresh fingerprint");
    } finally {
      setIsFingerprintLoading(false);
    }
  };

  const handleRegisterTerminal = async () => {
    if (!activeStore?._id) {
      toast.error("Missing active store context");
      return;
    }
    if (!currentUser?._id) {
      toast.error("Unable to determine current user");
      return;
    }
    if (!fingerprintResult) {
      toast.error("Fingerprint not ready yet");
      return;
    }
    if (!displayName.trim()) {
      toast.error("Display name is required");
      return;
    }

    setIsRegistering(true);
    try {
      await registerTerminalMutation({
        storeId: activeStore._id,
        fingerprintHash: fingerprintResult.fingerprintHash,
        displayName: displayName.trim(),
        registeredByUserId: currentUser._id,
        browserInfo: fingerprintResult.browserInfo,
      });
      toast.success("Terminal registered");
      setNameTouched(false);
    } catch (error) {
      console.error(error);
      toast.error("Unable to register terminal");
    } finally {
      setIsRegistering(false);
    }
  };

  const handleRename = async (terminalId: Id<"posTerminal">, name: string) => {
    markTerminalBusy(terminalId, true);
    try {
      await updateTerminalMutation({
        terminalId,
        displayName: name,
      });
    } finally {
      markTerminalBusy(terminalId, false);
    }
  };

  const handleStatusChange = async (
    terminalId: Id<"posTerminal">,
    status: TerminalStatus
  ) => {
    markTerminalBusy(terminalId, true);
    try {
      await updateTerminalMutation({
        terminalId,
        status,
      });
      toast.success(`Terminal marked as ${status}`);
    } catch (error) {
      console.error(error);
      toast.error("Unable to update terminal status");
    } finally {
      markTerminalBusy(terminalId, false);
    }
  };

  const handleDelete = async (terminalId: Id<"posTerminal">) => {
    markTerminalBusy(terminalId, true);
    try {
      await deleteTerminalMutation({
        terminalId,
      });
      toast.success("Terminal deleted");
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete terminal");
    } finally {
      markTerminalBusy(terminalId, false);
    }
  };

  const trimmedDisplayName = displayName.trim();

  const isExistingTerminal = !!existingTerminal;

  const isExistingTerminalBusy = existingTerminal
    ? !!busyTerminalIds[existingTerminal._id]
    : false;

  const canRegister =
    !!fingerprintResult &&
    !fingerprintError &&
    !isExistingTerminal &&
    !!trimmedDisplayName;

  const canUpdateExisting =
    isExistingTerminal &&
    !!trimmedDisplayName &&
    trimmedDisplayName !== existingTerminal.displayName;

  const handleUpdateExistingTerminal = async () => {
    if (!existingTerminal || !canUpdateExisting) {
      return;
    }
    setIsUpdatingExisting(true);
    try {
      await handleRename(existingTerminal._id, trimmedDisplayName);
      setNameTouched(false);
      toast.success("Terminal name updated");
    } catch (error) {
      console.error(error);
      toast.error("Unable to update terminal name");
    } finally {
      setIsUpdatingExisting(false);
    }
  };

  const fingerprintSection = (
    <View
      header={<ViewHeader title="Register terminal" />}
      hideHeaderBottomBorder
    >
      <CardContent className="space-y-4 p-6">
        <div className="flex gap-4">
          <div className="space-y-2">
            <Label htmlFor="terminal-name">Terminal name</Label>
            <div className="flex gap-2">
              <Input
                id="terminal-name"
                placeholder="Front Counter Terminal"
                className="w-[300px]"
                value={displayName}
                onChange={(event) => {
                  setNameTouched(true);
                  setDisplayName(event.target.value);
                }}
              />
              {!isExistingTerminal && (
                <LoadingButton
                  onClick={handleRegisterTerminal}
                  isLoading={isRegistering}
                  disabled={!canRegister}
                >
                  Register
                </LoadingButton>
              )}
              {isExistingTerminal && (
                <LoadingButton
                  onClick={handleUpdateExistingTerminal}
                  isLoading={isUpdatingExisting || isExistingTerminalBusy}
                  disabled={!canUpdateExisting || isExistingTerminalBusy}
                  variant="outline"
                >
                  Update terminal
                </LoadingButton>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {!isFingerprintLoading && fingerprintError && (
            <p className="text-sm text-destructive">{fingerprintError}</p>
          )}

          <div className="flex items-center gap-4">
            {existingTerminal && (
              <p className="text-sm text-muted-foreground">
                This terminal is registered as
                <span className="font-semibold">{` ${existingTerminal.displayName}`}</span>
              </p>
            )}
            {/* {existingTerminal && existingTerminal.status === "active" && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-primary/60 rounded-full" />
                <p className="text-sm text-primary font-medium">Active</p>
              </div>
            )} */}
          </div>
        </div>
      </CardContent>
    </View>
  );

  const terminalListSection = (
    <View header={<ViewHeader title="Registered terminals" />}>
      <CardContent className="space-y-4">
        {terminals !== undefined && terminals.length === 0 && (
          <FadeIn className="rounded-md border border-dashed bg-muted/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No terminals registered yet. Register the current browser to get
              started.
            </p>
          </FadeIn>
        )}
        {terminals &&
          terminals.map((terminal) => (
            <TerminalRow
              key={terminal._id}
              terminal={terminal}
              isBusy={!!busyTerminalIds[terminal._id]}
              onRename={handleRename}
              onChangeStatus={handleStatusChange}
              onDelete={handleDelete}
            />
          ))}
      </CardContent>
    </View>
  );

  return (
    <View
      header={
        <ComposedPageHeader
          leadingContent={
            <div>
              <p className="text-lg font-semibold text-gray-900">
                POS Settings
              </p>
            </div>
          }
        />
      }
    >
      <FadeIn className="container mx-auto h-full w-full p-6">
        <div className="grid gap-6">
          {fingerprintSection}
          {/* {terminalListSection} */}
        </div>
      </FadeIn>
    </View>
  );
}
