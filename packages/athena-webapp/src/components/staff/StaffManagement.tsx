import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { hashPin } from "~/src/lib/security/pinHash";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";
import { PinInput } from "../pos/PinInput";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

interface StaffManagementProps {
  storeId: Id<"store">;
  organizationId: Id<"organization">;
}

type OperationalRole =
  | "manager"
  | "front_desk"
  | "stylist"
  | "technician"
  | "cashier";

type StaffProfileRow = {
  _id: Id<"staffProfile">;
  credentialStatus: "pending" | "active" | "suspended" | "revoked" | null;
  email?: string | null;
  firstName: string;
  fullName: string;
  hiredAt?: number | null;
  jobTitle?: string | null;
  lastName: string;
  phoneNumber?: string | null;
  primaryRole?: OperationalRole | null;
  roles?: OperationalRole[];
  staffCode?: string | null;
  status: "active" | "inactive";
  username?: string | null;
};

type PinSetupDialogState = {
  mode: "set" | "reset";
  staff: StaffProfileRow;
};

const ROLE_OPTIONS: Array<{ label: string; value: OperationalRole }> = [
  { label: "Manager", value: "manager" },
  { label: "Front Desk", value: "front_desk" },
  { label: "Stylist", value: "stylist" },
  { label: "Technician", value: "technician" },
  { label: "Cashier", value: "cashier" },
];

const normalizeNameSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const MAX_USERNAME_LENGTH = 5;

const buildUsername = (first: string, last: string, suffix?: number) => {
  const normalizedFirst = normalizeNameSegment(first);
  const normalizedLast = normalizeNameSegment(last);

  if (!normalizedFirst || !normalizedLast) {
    return "";
  }

  const base = `${normalizedFirst[0] ?? ""}${normalizedLast}`;
  const suffixStr = suffix && suffix > 1 ? suffix.toString() : "";
  const availableLength = MAX_USERNAME_LENGTH - suffixStr.length;

  if (availableLength <= 0) {
    return "";
  }

  let username = base;
  if (base.length < availableLength) {
    const extended = base + normalizedFirst.slice(1);
    username = extended.slice(0, availableLength);
  } else {
    username = base.slice(0, availableLength);
  }

  return username + suffixStr;
};

const formatRoleLabel = (role?: OperationalRole | null) => {
  if (!role) {
    return "Unassigned";
  }

  return role
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

const formatStartDate = (timestamp?: number | null) => {
  if (!timestamp) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
};

const formatCredentialStatusLabel = (staff: StaffProfileRow) => {
  if (staff.status !== "active") {
    return "Inactive";
  }

  switch (staff.credentialStatus) {
    case "pending":
      return "Pending PIN";
    case "active":
      return "Active";
    case "suspended":
      return "Suspended";
    case "revoked":
      return "Revoked";
    default:
      return "Missing credential";
  }
};

const CredentialStatusBadge = ({ staff }: { staff: StaffProfileRow }) => {
  if (staff.status !== "active") {
    return (
      <Badge variant="outline" className="text-gray-400">
        Inactive
      </Badge>
    );
  }

  switch (staff.credentialStatus) {
    case "pending":
      return (
        <Badge
          variant="outline"
          className="border-amber-200 bg-amber-50 text-amber-700"
        >
          Pending PIN
        </Badge>
      );
    case "active":
      return (
        <Badge
          variant="outline"
          className="border-emerald-200 bg-emerald-50 text-emerald-700"
        >
          Active
        </Badge>
      );
    case "suspended":
      return <Badge variant="outline">Suspended</Badge>;
    case "revoked":
      return <Badge variant="destructive">Revoked</Badge>;
    default:
      return <Badge variant="outline">Missing credential</Badge>;
  }
};

function StaffProvisionForm({
  mode,
  organizationId,
  onCancel,
  onSuccess,
  staff,
  storeId,
}: {
  mode: "create" | "edit";
  organizationId: Id<"organization">;
  onCancel: () => void;
  onSuccess: () => void;
  staff?: StaffProfileRow | null;
  storeId: Id<"store">;
}) {
  const [firstName, setFirstName] = useState(staff?.firstName ?? "");
  const [lastName, setLastName] = useState(staff?.lastName ?? "");
  const [username, setUsername] = useState(staff?.username ?? "");
  const [usernameSuffix, setUsernameSuffix] = useState(1);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [selectedRole, setSelectedRole] = useState<OperationalRole | "">(
    staff?.primaryRole ?? "",
  );
  const [startDate, setStartDate] = useState(
    staff?.hiredAt ? new Date(staff.hiredAt).toISOString().slice(0, 10) : "",
  );
  const [jobTitle, setJobTitle] = useState(staff?.jobTitle ?? "");
  const [phoneNumber, setPhoneNumber] = useState(staff?.phoneNumber ?? "");
  const [email, setEmail] = useState(staff?.email ?? "");
  const [staffCode, setStaffCode] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const createStaffProfile = useMutation(
    api.operations.staffProfiles.createStaffProfile,
  );
  const updateStaffProfile = useMutation(
    api.operations.staffProfiles.updateStaffProfile,
  );

  const initialFirstName = staff?.firstName ?? "";
  const initialLastName = staff?.lastName ?? "";
  const initialUsername = staff?.username?.trim().toLowerCase() ?? "";
  const shouldAutoGenerateUsername =
    mode === "create" ||
    (mode === "edit" &&
      (firstName.trim() !== initialFirstName.trim() ||
        lastName.trim() !== initialLastName.trim()));

  const candidateUsername = useMemo(() => {
    if (!shouldAutoGenerateUsername || !isCheckingUsername) {
      return "";
    }

    return buildUsername(firstName, lastName, usernameSuffix);
  }, [
    firstName,
    isCheckingUsername,
    lastName,
    shouldAutoGenerateUsername,
    usernameSuffix,
  ]);

  const usernameAvailability = useQuery(
    api.operations.staffCredentials.getStaffCredentialUsernameAvailability,
    candidateUsername &&
      !(mode === "edit" && candidateUsername === initialUsername)
      ? { storeId, username: candidateUsername }
      : "skip",
  );

  useEffect(() => {
    setFirstName(staff?.firstName ?? "");
    setLastName(staff?.lastName ?? "");
    setUsername(staff?.username ?? "");
    setSelectedRole(staff?.primaryRole ?? "");
    setStartDate(
      staff?.hiredAt ? new Date(staff.hiredAt).toISOString().slice(0, 10) : "",
    );
    setJobTitle(staff?.jobTitle ?? "");
    setPhoneNumber(staff?.phoneNumber ?? "");
    setEmail(staff?.email ?? "");
    setStaffCode(staff?.staffCode ?? "");
    setUsernameSuffix(1);
    setIsCheckingUsername(mode === "create");
  }, [mode, staff]);

  useEffect(() => {
    if (!shouldAutoGenerateUsername) {
      if (mode === "edit") {
        setUsername(staff?.username ?? "");
      }
      setUsernameSuffix(1);
      setIsCheckingUsername(false);
      return;
    }

    const normalizedFirst = normalizeNameSegment(firstName);
    const normalizedLast = normalizeNameSegment(lastName);

    if (!normalizedFirst || !normalizedLast) {
      setUsername("");
      setUsernameSuffix(1);
      setIsCheckingUsername(false);
      return;
    }

    setUsername("");
    setUsernameSuffix(1);
    setIsCheckingUsername(true);
  }, [firstName, lastName, mode, shouldAutoGenerateUsername, staff]);

  useEffect(() => {
    if (!shouldAutoGenerateUsername) {
      return;
    }

    if (!isCheckingUsername) {
      return;
    }

    if (!candidateUsername) {
      setUsername("");
      setIsCheckingUsername(false);
      return;
    }

    if (mode === "edit" && candidateUsername === initialUsername) {
      setUsername(candidateUsername);
      setIsCheckingUsername(false);
      return;
    }

    if (usernameAvailability === undefined) {
      return;
    }

    if (usernameAvailability.available) {
      setUsername(candidateUsername);
      setIsCheckingUsername(false);
      return;
    }

    setUsernameSuffix((previous) => previous + 1);
  }, [
    candidateUsername,
    initialUsername,
    isCheckingUsername,
    mode,
    shouldAutoGenerateUsername,
    usernameAvailability,
  ]);

  const isUsernamePending = isCheckingUsername;

  const isValid =
    firstName.trim() &&
    lastName.trim() &&
    username.trim() &&
    selectedRole &&
    !isUsernamePending;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!isValid) {
      toast.error("Complete the required staff details before saving.");
      return;
    }

    setIsSaving(true);
    try {
      const hiredAt = startDate
        ? new Date(`${startDate}T00:00:00`).getTime()
        : undefined;

      const payload = {
        email: email.trim() || undefined,
        firstName: firstName.trim(),
        hiredAt,
        jobTitle: jobTitle.trim() || undefined,
        lastName: lastName.trim(),
        organizationId,
        phoneNumber: phoneNumber.trim() || undefined,
        requestedRoles: [selectedRole as OperationalRole],
        staffCode: staffCode.trim() || undefined,
        storeId,
        username: username.trim(),
      };

      const result = await runCommand(() =>
        mode === "create"
          ? createStaffProfile(payload)
          : updateStaffProfile({
            ...payload,
            staffProfileId: staff?._id as Id<"staffProfile">,
          })
      );

      if (result.kind !== "ok" || !result.data?._id) {
        if (result.kind !== "ok") {
          presentCommandToast(result);
        } else {
          toast.error(
            mode === "create"
              ? "Failed to add staff member"
              : "Failed to update staff member",
          );
        }
        return;
      }

      toast.success(
        mode === "create"
          ? "Staff member added. PIN setup is still pending."
          : "Staff member updated.",
      );
      onSuccess();
    } catch (error) {
      toast.error(
        (error as Error).message ||
        (mode === "create"
          ? "Failed to add staff member"
          : "Failed to update staff member"),
      );
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (
      event.key !== "Enter" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const isTextArea = target instanceof HTMLTextAreaElement;
    const isButton = target instanceof HTMLButtonElement;
    const isExpandedControl = target?.getAttribute("aria-expanded") === "true";

    if (isTextArea || isButton || isExpandedControl) {
      return;
    }

    event.preventDefault();
    formRef.current?.requestSubmit();
  };

  return (
    <form
      ref={formRef}
      onKeyDown={handleKeyDown}
      onSubmit={handleSubmit}
      className="overflow-hidden"
    >
      <DialogHeader className="border-b bg-surface px-6 py-5">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Staff profile
          </p>
          <DialogTitle>
            {mode === "create" ? "Add staff member" : "Edit staff member"}
          </DialogTitle>
          <DialogDescription>
            Capture the profile details staff use across POS, services, and
            cash controls. PIN setup happens after the profile is saved.
          </DialogDescription>
        </div>
      </DialogHeader>

      <div className="max-h-[min(72vh,42rem)] overflow-y-auto px-6 py-6">
        <div className="space-y-6">
          <section className="space-y-4">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">
                Required details
              </h4>
              <p className="text-sm text-muted-foreground">
                Name, role, and username are needed before this staff member can
                be saved.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="staff-first-name">First name</Label>
                <Input
                  id="staff-first-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-last-name">Last name</Label>
                <Input
                  id="staff-last-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-username">Username</Label>
                <Input
                  id="staff-username"
                  value={isUsernamePending ? "Checking..." : username}
                  readOnly
                  className="cursor-not-allowed bg-muted"
                  disabled={isUsernamePending}
                />
                <p className="text-xs text-muted-foreground">
                  Auto-generated from first and last name.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-role">Role</Label>
                <Select
                  value={selectedRole}
                  onValueChange={(value) =>
                    setSelectedRole(value as OperationalRole)
                  }
                >
                  <SelectTrigger id="staff-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border/80 bg-background p-4">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">
                Work and contact
              </h4>
              <p className="text-sm text-muted-foreground">
                Optional details help managers identify staff in operational
                records.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="staff-start-date">Start date</Label>
                <Input
                  id="staff-start-date"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-job-title">Job title</Label>
                <Input
                  id="staff-job-title"
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-phone">Phone number</Label>
                <Input
                  id="staff-phone"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-email">Email</Label>
                <Input
                  id="staff-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <DialogFooter className="border-t bg-surface px-6 py-4">
        <Button
          variant="outline"
          type="button"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>

        <LoadingButton
          type="submit"
          className="min-w-[112px]"
          isLoading={isSaving}
          disabled={!isValid}
        >
          {mode === "create" ? "Save" : "Update"}
        </LoadingButton>
      </DialogFooter>
    </form>
  );
}

function CredentialPinDialog({
  onClose,
  organizationId,
  state,
  storeId,
}: {
  onClose: () => void;
  organizationId: Id<"organization">;
  state: PinSetupDialogState | null;
  storeId: Id<"store">;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const updateStaffCredential = useMutation(
    api.operations.staffCredentials.updateStaffCredential,
  );

  useEffect(() => {
    if (!state) {
      setPin("");
      setConfirmPin("");
    }
  }, [state]);

  const showMismatch = Boolean(
    pin.length > 0 && pin.length === confirmPin.length && pin !== confirmPin,
  );

  const handlePinKeyDown = (event: React.KeyboardEvent) => {
    const allowedKeys = [
      "Backspace",
      "Tab",
      "ArrowLeft",
      "ArrowRight",
      "Delete",
    ];

    if (
      !/^\d$/.test(event.key) &&
      !allowedKeys.includes(event.key) &&
      event.key !== "Enter"
    ) {
      event.preventDefault();
    }
  };

  const handleSubmit = async () => {
    if (!state) {
      return;
    }

    if (!/^\d{6}$/.test(pin)) {
      toast.error("PIN must be exactly 6 digits");
      return;
    }

    if (pin !== confirmPin) {
      toast.error("PINs do not match");
      return;
    }

    setIsSaving(true);
    try {
      const pinHash = await hashPin(pin);

      const result = await runCommand(() =>
        updateStaffCredential({
          organizationId,
          pinHash,
          staffProfileId: state.staff._id,
          status: "active",
          storeId,
        })
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast.success(
        state.mode === "set"
          ? "PIN saved and credential activated"
          : "PIN reset successfully",
      );
      onClose();
    } catch (error) {
      toast.error((error as Error).message || "Failed to save PIN");
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "set" ? "Set staff PIN" : "Reset staff PIN"}
          </DialogTitle>
          <DialogDescription>
            {state
              ? `${state.staff.fullName} will use ${state.staff.username} to sign in.`
              : "Configure the staff PIN."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="staff-pin">PIN</Label>
            <PinInput
              value={pin}
              onChange={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
              disabled={isSaving}
              onKeyDown={handlePinKeyDown}
              maxLength={6}
              size="sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="staff-confirm-pin">Confirm PIN</Label>
            <PinInput
              value={confirmPin}
              onChange={(value) =>
                setConfirmPin(value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={isSaving}
              onKeyDown={handlePinKeyDown}
              maxLength={6}
              size="sm"
            />
          </div>

          {showMismatch && (
            <p className="text-sm font-medium text-destructive">
              PINs don&apos;t match
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <LoadingButton
            onClick={handleSubmit}
            isLoading={isSaving}
            disabled={
              pin.length !== 6 || confirmPin.length !== 6 || pin !== confirmPin
            }
          >
            {state?.mode === "set" ? "Save PIN" : "Reset PIN"}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const StaffManagement = ({
  storeId,
  organizationId,
}: StaffManagementProps) => {
  const [formState, setFormState] = useState<
    { mode: "create" } | { mode: "edit"; staff: StaffProfileRow } | null
  >(null);
  const [pinSetupState, setPinSetupState] =
    useState<PinSetupDialogState | null>(null);
  const [staffToDeactivate, setStaffToDeactivate] =
    useState<StaffProfileRow | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);

  const staffProfiles = useQuery(
    api.operations.staffProfiles.listStaffProfiles,
    {
      storeId,
    },
  ) as StaffProfileRow[] | undefined;

  const updateStaffProfile = useMutation(
    api.operations.staffProfiles.updateStaffProfile,
  );
  const updateStaffCredential = useMutation(
    api.operations.staffCredentials.updateStaffCredential,
  );

  const roster = useMemo(
    () =>
      [...(staffProfiles ?? [])].sort((left, right) =>
        left.fullName.localeCompare(right.fullName),
      ),
    [staffProfiles],
  );

  const handleDeactivate = async () => {
    if (!staffToDeactivate) {
      return;
    }

    setIsDeactivating(true);
    try {
      const [profileResult, credentialResult] = await Promise.all([
        runCommand(() =>
          updateStaffProfile({
            organizationId,
            staffProfileId: staffToDeactivate._id,
            status: "inactive",
            storeId,
          })
        ),
        runCommand(() =>
          updateStaffCredential({
            organizationId,
            staffProfileId: staffToDeactivate._id,
            status: "revoked",
            storeId,
          })
        ),
      ]);

      if (profileResult.kind !== "ok") {
        presentCommandToast(profileResult);
        return;
      }

      if (credentialResult.kind !== "ok") {
        presentCommandToast(credentialResult);
        return;
      }

      toast.success("Staff member deactivated");
      setStaffToDeactivate(null);
    } catch (error) {
      toast.error(
        (error as Error).message || "Failed to deactivate staff member",
      );
      console.error(error);
    } finally {
      setIsDeactivating(false);
    }
  };

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Staff</h3>
        <p className="text-sm text-muted-foreground">
          Manage profiles for staff members
        </p>
      </div>

      {roster.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {/* <TableHead>Role</TableHead> */}
                {/* <TableHead>Start date</TableHead> */}
                <TableHead>Status</TableHead>
                <TableHead className="w-[240px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster.map((staff) => {
                const canSetPin =
                  staff.status === "active" &&
                  (staff.credentialStatus === "pending" ||
                    staff.credentialStatus === "active");
                const canDeactivate =
                  staff.status === "active" &&
                  staff.credentialStatus !== "revoked";

                return (
                  <TableRow key={staff._id}>
                    <TableCell className="flex items-center gap-4">
                      <div className="flex gap-2 items-center">
                        <div className="font-medium">{staff.fullName}</div>
                        <p className="text-muted-foreground text-sm">
                          {staff.username ?? "—"}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {formatRoleLabel(staff.primaryRole)}
                      </Badge>
                    </TableCell>
                    {/* <TableCell className="text-muted-foreground">
                      {staff.username ?? "—"}
                    </TableCell> */}
                    {/* <TableCell>
                      <Badge variant="outline">
                        {formatRoleLabel(staff.primaryRole)}
                      </Badge>
                    </TableCell> */}
                    {/* <TableCell className="text-muted-foreground">
                      {formatStartDate(staff.hiredAt)}
                    </TableCell> */}
                    <TableCell>
                      <div className="space-y-1">
                        <CredentialStatusBadge staff={staff} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {canSetPin ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPinSetupState({
                                mode:
                                  staff.credentialStatus === "pending"
                                    ? "set"
                                    : "reset",
                                staff,
                              })
                            }
                          >
                            {staff.credentialStatus === "pending"
                              ? "Set PIN"
                              : "Reset PIN"}
                          </Button>
                        ) : null}

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setFormState({
                              mode: "edit",
                              staff,
                            })
                          }
                        >
                          Edit
                        </Button>

                        {canDeactivate ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setStaffToDeactivate(staff)}
                          >
                            <UserMinus className="mr-2 h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            No actions
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No staff members added yet.
        </p>
      )}

      <Button variant="ghost" onClick={() => setFormState({ mode: "create" })}>
        <Plus className="mr-2 h-4 w-4" />
        Add Staff Member
      </Button>

      <Dialog
        open={formState !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFormState(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          {formState ? (
            <StaffProvisionForm
              mode={formState.mode}
              organizationId={organizationId}
              onCancel={() => setFormState(null)}
              onSuccess={() => setFormState(null)}
              staff={formState.mode === "edit" ? formState.staff : null}
              storeId={storeId}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <CredentialPinDialog
        onClose={() => setPinSetupState(null)}
        organizationId={organizationId}
        state={pinSetupState}
        storeId={storeId}
      />

      <Dialog
        open={staffToDeactivate !== null}
        onOpenChange={(open) => !open && setStaffToDeactivate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate staff member</DialogTitle>
            <DialogDescription>
              This will mark the staff profile inactive and revoke the reserved
              or active credential for{" "}
              {staffToDeactivate?.fullName ?? "this staff member"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStaffToDeactivate(null)}
              disabled={isDeactivating}
            >
              Cancel
            </Button>
            <LoadingButton
              variant="ghost"
              onClick={handleDeactivate}
              isLoading={isDeactivating}
            >
              Deactivate
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
