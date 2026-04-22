import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { hashPin } from "~/src/lib/security/pinHash";
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

interface CashierManagementProps {
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
  firstName: string;
  fullName: string;
  hiredAt?: number | null;
  lastName: string;
  primaryRole?: OperationalRole | null;
  roles?: OperationalRole[];
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
  organizationId,
  onCancel,
  onSuccess,
  storeId,
}: {
  organizationId: Id<"organization">;
  onCancel: () => void;
  onSuccess: () => void;
  storeId: Id<"store">;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameSuffix, setUsernameSuffix] = useState(1);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [selectedRole, setSelectedRole] = useState<OperationalRole | "">("");
  const [startDate, setStartDate] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const createStaffProfile = useMutation(
    api.operations.staffProfiles.createStaffProfile,
  );

  const candidateUsername = useMemo(() => {
    if (!isCheckingUsername) {
      return "";
    }

    return buildUsername(firstName, lastName, usernameSuffix);
  }, [firstName, lastName, usernameSuffix, isCheckingUsername]);

  const usernameAvailability = useQuery(
    api.operations.staffCredentials.getStaffCredentialUsernameAvailability,
    candidateUsername ? { storeId, username: candidateUsername } : "skip",
  );

  useEffect(() => {
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
  }, [firstName, lastName]);

  useEffect(() => {
    if (!isCheckingUsername) {
      return;
    }

    if (!candidateUsername) {
      setUsername("");
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
  }, [candidateUsername, isCheckingUsername, usernameAvailability]);

  const isValid =
    firstName.trim() &&
    lastName.trim() &&
    username.trim() &&
    selectedRole &&
    !isCheckingUsername;

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

      const profile = await createStaffProfile({
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
        username,
      });

      if (!profile?._id) {
        toast.error("Failed to add staff member");
        return;
      }

      toast.success("Staff member added. PIN setup is still pending.");
      onSuccess();
    } catch (error) {
      toast.error((error as Error).message || "Failed to add staff member");
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-2">
        <p className="text-lg font-medium">Add staff member</p>
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
            value={isCheckingUsername ? "Checking..." : username}
            readOnly
            className="cursor-not-allowed bg-muted"
            disabled={isCheckingUsername}
          />
          <p className="text-xs text-muted-foreground">
            Auto-generated from first and last name
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="staff-role">Role</Label>
          <Select
            value={selectedRole}
            onValueChange={(value) => setSelectedRole(value as OperationalRole)}
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

        {/* <div className="space-y-2 md:col-span-2">
          <Label htmlFor="staff-code">Staff code</Label>
          <Input
            id="staff-code"
            placeholder="ST-017"
            value={staffCode}
            onChange={(event) => setStaffCode(event.target.value)}
          />
        </div> */}
      </div>

      <div className="flex items-center gap-4">
        <LoadingButton
          type="submit"
          variant="outline"
          className="min-w-[96px]"
          isLoading={isSaving}
          disabled={!isValid}
        >
          Save
        </LoadingButton>

        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
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

      await updateStaffCredential({
        organizationId,
        pinHash,
        staffProfileId: state.staff._id,
        status: "active",
        storeId,
      });

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
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <LoadingButton
            variant="ghost"
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

export const CashierManagement = ({
  storeId,
  organizationId,
}: CashierManagementProps) => {
  const [showForm, setShowForm] = useState(false);
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
      await Promise.all([
        updateStaffProfile({
          organizationId,
          staffProfileId: staffToDeactivate._id,
          status: "inactive",
          storeId,
        }),
        updateStaffCredential({
          organizationId,
          staffProfileId: staffToDeactivate._id,
          status: "revoked",
          storeId,
        }),
      ]);

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

      {showForm ? (
        <div className="w-[50%]">
          <StaffProvisionForm
            organizationId={organizationId}
            onCancel={() => setShowForm(false)}
            onSuccess={() => setShowForm(false)}
            storeId={storeId}
          />
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Staff Member
        </Button>
      )}

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
