import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
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

  // Calculate available length for the base username
  const availableLength = MAX_USERNAME_LENGTH - suffixStr.length;

  if (availableLength <= 0) {
    return "";
  }

  // Try to build username with suffix
  let username = base;
  if (base.length < availableLength) {
    // Add more characters from first name if we have room
    const extended = base + normalizedFirst.slice(1);
    username = extended.slice(0, availableLength);
  } else {
    username = base.slice(0, availableLength);
  }

  return username + suffixStr;
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

  const createCashier = useMutation(api.inventory.cashier.create);

  // Compute candidate username without updating state
  const candidateUsername = useMemo(() => {
    if (!isCheckingUsername) return "";
    return buildUsername(firstName, lastName, usernameSuffix);
  }, [firstName, lastName, usernameSuffix, isCheckingUsername]);

  const isUsernameAvailable = useQuery(
    api.inventory.cashier.checkUsernameAvailable,
    candidateUsername ? { storeId, username: candidateUsername } : "skip"
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
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
      // Hash the PIN client-side before sending to backend
      const hashedPin = await hashPin(pin);

      const result = await createCashier({
        firstName,
        lastName,
        username,
        pin: hashedPin,
        storeId,
        organizationId,
      });

      if (result?.success) {
        toast.success("Cashier added");
        onSuccess();
      } else {
        toast.error(result?.error || "Failed to add cashier");
      }
    } catch (error) {
      toast.error("Failed to add cashier");
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

  // Generate unique username with suffix when names change
  useEffect(() => {
    const normalizedFirst = normalizeNameSegment(firstName);
    const normalizedLast = normalizeNameSegment(lastName);

    if (!normalizedFirst || !normalizedLast) {
      setUsername("");
      setUsernameSuffix(1);
      setIsCheckingUsername(false);
      return;
    }

    // Reset to suffix 1 when names change
    setUsernameSuffix(1);
    setIsCheckingUsername(true);
  }, [firstName, lastName]);

  // Check username availability and increment suffix if needed
  useEffect(() => {
    if (!isCheckingUsername) return;
    if (!candidateUsername) {
      setUsername("");
      setIsCheckingUsername(false);
      return;
    }
    if (isUsernameAvailable === undefined) return;

    if (isUsernameAvailable) {
      // Username is available, use it
      setUsername(candidateUsername);
      setIsCheckingUsername(false);
    } else {
      // Username taken, try next suffix
      setUsernameSuffix((prev) => prev + 1);
    }
  }, [candidateUsername, isUsernameAvailable, isCheckingUsername]);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <p className="text-md font-medium">Add cashier</p>
      <div className="grid grid-cols-2 gap-8 w-[600px]">
        <div className="space-y-2">
          {/* <Label htmlFor="firstName">First Name</Label> */}
          <Input
            id="firstName"
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          {/* <Label htmlFor="lastName">Last Name</Label> */}
          <Input
            id="lastName"
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>

        <div className="space-y-2 relative">
          {/* <Label htmlFor="username">Username</Label> */}
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
  const [cashierToDelete, setCashierToDelete] = useState<Id<"cashier"> | null>(
    null
  );

  const cashiers = useQuery(api.inventory.cashier.getByStoreId, { storeId });
  const removeCashier = useMutation(api.inventory.cashier.remove);

  const handleDelete = async () => {
    if (!cashierToDelete) return;

    try {
      const result = await removeCashier({ id: cashierToDelete });

      if (result.success) {
        toast.success("Cashier removed");
      } else {
        toast.error(result.error || "Failed to remove cashier");
      }
    } catch (error) {
      toast.error("Failed to remove cashier");
      console.error(error);
    } finally {
      setCashierToDelete(null);
    }
  };

  const activeCashiers = cashiers?.filter((c) => c.active) || [];

  return (
    <div className="space-y-16">
      <div>
        <h3 className="text-lg font-medium mb-4">Cashiers</h3>

        {activeCashiers.length > 0 && (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeCashiers.map((cashier) => (
                  <TableRow key={cashier._id}>
                    <TableCell>
                      {cashier.firstName} {cashier.lastName}{" "}
                      <span className="text-muted-foreground">
                        {cashier.username}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono">{"•".repeat(6)}</span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCashierToDelete(cashier._id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {activeCashiers.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground">
            No cashiers added yet. Add a cashier to get started.
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
          Add Cashier
        </Button>
      )}

      <Dialog
        open={cashierToDelete !== null}
        onOpenChange={(open: boolean) => !open && setCashierToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Cashier</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this cashier? This will deactivate
              their account and they will no longer be able to use the POS
              system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashierToDelete(null)}>
              Cancel
            </Button>
            <Button onClick={handleDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
