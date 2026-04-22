import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { toast } from "sonner";
import { Plus, UserMinus } from "lucide-react";
import { hashPin } from "~/src/lib/security/pinHash";
import { PinInput } from "../pos/PinInput";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface CashierManagementProps {
  storeId: Id<"store">;
  organizationId: Id<"organization">;
}

interface CashierFormProps {
  storeId: Id<"store">;
  organizationId: Id<"organization">;
  onSuccess: () => void;
  onCancel: () => void;
}

type StaffProfileRow = {
  _id: Id<"staffProfile">;
  firstName?: string | null;
  fullName: string;
  lastName?: string | null;
  roles?: Array<"manager" | "front_desk" | "stylist" | "technician" | "cashier">;
  status: "active" | "inactive";
};

type StaffCredentialRow = {
  _id: Id<"staffCredential">;
  staffProfileId: Id<"staffProfile">;
  status: "active" | "suspended" | "revoked";
  username: string;
};

type StaffRosterRow = {
  credentialId: Id<"staffCredential">;
  credentialStatus: StaffCredentialRow["status"];
  displayName: string;
  fullName: string;
  profileId: Id<"staffProfile">;
  profileStatus: StaffProfileRow["status"];
  roles: Array<"manager" | "front_desk" | "stylist" | "technician" | "cashier">;
  username: string;
};

const normalizeNameSegment = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

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

const buildFullName = (first: string, last: string) =>
  [first.trim(), last.trim()].filter(Boolean).join(" ");

const getDisplayName = (profile: {
  firstName?: string | null;
  fullName: string;
  lastName?: string | null;
}) => {
  const fullName = profile.fullName.trim();
  if (fullName) {
    return fullName;
  }

  const parts = [profile.firstName?.trim(), profile.lastName?.trim()].filter(
    (part): part is string => Boolean(part)
  );

  return parts.join(" ").trim();
};

const formatStatusLabel = (row: StaffRosterRow) => {
  if (row.profileStatus !== "active") {
    return "Inactive";
  }

  if (row.credentialStatus === "active") {
    return "Active";
  }

  return (
    row.credentialStatus.charAt(0).toUpperCase() +
    row.credentialStatus.slice(1)
  );
};

const CashierForm = ({
  storeId,
  organizationId,
  onSuccess,
  onCancel,
}: CashierFormProps) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameSuffix, setUsernameSuffix] = useState(1);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const createStaffProfile = useMutation(
    api.operations.staffProfiles.createStaffProfile
  );
  const createStaffCredential = useMutation(
    api.operations.staffCredentials.createStaffCredential
  );
  const updateStaffProfile = useMutation(
    api.operations.staffProfiles.updateStaffProfile
  );

  const candidateUsername = useMemo(() => {
    if (!isCheckingUsername) return "";
    return buildUsername(firstName, lastName, usernameSuffix);
  }, [firstName, lastName, usernameSuffix, isCheckingUsername]);

  const usernameAvailability = useQuery(
    api.operations.staffCredentials.getStaffCredentialUsernameAvailability,
    candidateUsername ? { storeId, username: candidateUsername } : "skip"
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First name and last name are required");
      return;
    }

    if (!username.trim()) {
      toast.error("Username is required");
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
      const hashedPin = await hashPin(pin);
      const fullName = buildFullName(firstName, lastName);

      const profile = await createStaffProfile({
        firstName: firstName.trim(),
        fullName,
        lastName: lastName.trim(),
        organizationId,
        requestedRoles: ["cashier"],
        storeId,
      });

      if (!profile?._id) {
        toast.error("Failed to add staff member");
        return;
      }

      const credential = await createStaffCredential({
        organizationId,
        pinHash: hashedPin,
        staffProfileId: profile._id,
        storeId,
        username,
      }).catch(async (credentialError) => {
        await updateStaffProfile({
          organizationId,
          staffProfileId: profile._id,
          status: "inactive",
          storeId,
        });
        throw credentialError;
      });

      if (credential?._id) {
        toast.success("Staff member added");
        onSuccess();
        return;
      }

      toast.error("Failed to add staff member");
    } catch (error) {
      toast.error((error as Error).message || "Failed to add staff member");
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const isValid =
    firstName.trim() &&
    lastName.trim() &&
    username.trim() &&
    !isCheckingUsername &&
    /^\d{6}$/.test(pin) &&
    pin === confirmPin;

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

  useEffect(() => {
    const normalizedFirst = normalizeNameSegment(firstName);
    const normalizedLast = normalizeNameSegment(lastName);

    if (!normalizedFirst || !normalizedLast) {
      setUsername("");
      setUsernameSuffix(1);
      setIsCheckingUsername(false);
      return;
    }

    setUsernameSuffix(1);
    setIsCheckingUsername(true);
  }, [firstName, lastName]);

  useEffect(() => {
    if (!isCheckingUsername) return;
    if (!candidateUsername) {
      setUsername("");
      setIsCheckingUsername(false);
      return;
    }
    if (usernameAvailability === undefined) return;

    if (usernameAvailability.available) {
      setUsername(candidateUsername);
      setIsCheckingUsername(false);
    } else {
      setUsernameSuffix((prev) => prev + 1);
    }
  }, [candidateUsername, isCheckingUsername, usernameAvailability]);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <p className="text-md font-medium">Add staff member</p>
      <div className="grid grid-cols-2 gap-8 w-[600px]">
        <div className="space-y-2">
          <Input
            id="firstName"
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Input
            id="lastName"
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>

        <div className="space-y-2 relative">
          <Input
            id="username"
            placeholder="Username"
            value={isCheckingUsername ? "Checking..." : username}
            readOnly
            autoComplete="off"
            className="cursor-not-allowed bg-muted"
            disabled={isCheckingUsername}
          />
        </div>
      </div>

      <div className="grid grid-rows-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="pin">PIN</Label>
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
          <Label htmlFor="confirmPin">Confirm PIN</Label>
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
      </div>

      <div className="flex items-center gap-4">
        <LoadingButton
          type="submit"
          variant="outline"
          className="w-[80px]"
          isLoading={isSaving}
          disabled={!isValid}
        >
          Add
        </LoadingButton>

        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

export const CashierManagement = ({
  storeId,
  organizationId,
}: CashierManagementProps) => {
  const [showForm, setShowForm] = useState(false);
  const [staffToDeactivate, setStaffToDeactivate] =
    useState<StaffRosterRow | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);

  const staffProfiles = useQuery(api.operations.staffProfiles.listStaffProfiles, {
    storeId,
  }) as StaffProfileRow[] | undefined;
  const staffCredentials = useQuery(
    api.operations.staffCredentials.listStaffCredentialsByStore,
    { storeId }
  ) as StaffCredentialRow[] | undefined;

  const updateStaffProfile = useMutation(
    api.operations.staffProfiles.updateStaffProfile
  );
  const updateStaffCredential = useMutation(
    api.operations.staffCredentials.updateStaffCredential
  );

  const roster = useMemo(() => {
    const credentialByProfileId = new Map(
      (staffCredentials ?? []).map((credential) => [
        credential.staffProfileId,
        credential,
      ])
    );

    return (staffProfiles ?? [])
      .map((profile) => {
        const credential = credentialByProfileId.get(profile._id);
        if (!credential) {
          return null;
        }

        return {
          credentialId: credential._id,
          credentialStatus: credential.status,
          displayName: getDisplayName(profile),
          fullName: profile.fullName,
          profileId: profile._id,
          profileStatus: profile.status,
          roles: profile.roles ?? [],
          username: credential.username,
        } satisfies StaffRosterRow;
      })
      .filter((row): row is StaffRosterRow => row !== null)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [staffCredentials, staffProfiles]);

  const handleDeactivate = async () => {
    if (!staffToDeactivate) return;

    setIsDeactivating(true);
    try {
      await Promise.all([
        updateStaffProfile({
          organizationId,
          staffProfileId: staffToDeactivate.profileId,
          status: "inactive",
          storeId,
        }),
        updateStaffCredential({
          organizationId,
          staffProfileId: staffToDeactivate.profileId,
          status: "revoked",
          storeId,
        }),
      ]);

      toast.success("Staff member deactivated");
    } catch (error) {
      toast.error(
        (error as Error).message || "Failed to deactivate staff member"
      );
      console.error(error);
    } finally {
      setIsDeactivating(false);
      setStaffToDeactivate(null);
    }
  };

  return (
    <div className="space-y-16">
      <div>
        <h3 className="text-lg font-medium mb-4">POS Staff</h3>

        {roster.length > 0 && (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((staff) => (
                  <TableRow key={staff.credentialId}>
                    <TableCell>
                      {staff.displayName}
                      {staff.roles.length > 0 && (
                        <span className="ml-2 text-muted-foreground text-xs">
                          {staff.roles.join(", ")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">
                        {staff.username}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">
                        {formatStatusLabel(staff)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {staff.profileStatus === "active" &&
                      staff.credentialStatus === "active" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStaffToDeactivate(staff)}
                        >
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {roster.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground">
            No POS staff added yet. Add a staff member to get started.
          </p>
        )}
      </div>

      {showForm && (
        <CashierForm
          storeId={storeId}
          organizationId={organizationId}
          onSuccess={() => {
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {!showForm && (
        <Button variant="ghost" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Staff Member
        </Button>
      )}

      <Dialog
        open={staffToDeactivate !== null}
        onOpenChange={(open: boolean) => !open && setStaffToDeactivate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate Staff Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to deactivate this staff member? This will
              revoke their POS credential and mark their staff profile inactive.
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
            <Button onClick={handleDeactivate} disabled={isDeactivating}>
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
