import View from "../View";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useState } from "react";
import { LoadingButton } from "../ui/loading-button";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useAuth } from "~/src/hooks/useAuth";
import { useGetActiveOrganization } from "~/src/hooks/useGetOrganizations";
import { toast } from "sonner";
import { InviteDataTable } from "./invites-table/components/data-table";
import { inviteColumns } from "./invites-table/components/inviteColumns";
import { MembersDataTable } from "./members-table/components/data-table";
import { membersColumns } from "./members-table/components/membersColumns";

const organizationMemberSchema = z.object({
  email: z.string().email(),
  role: z.string(),
});

const Header = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <p className="text-3xl font-medium text-muted-foreground">
        Organization Members
      </p>
    </div>
  );
};

const Invites = () => {
  const { activeOrganization } = useGetActiveOrganization();

  const inviteCodes = useQuery(
    api.inventory.inviteCode.getAll,
    activeOrganization?._id
      ? { organizationId: activeOrganization._id }
      : "skip"
  );

  return (
    <div>
      {inviteCodes && inviteCodes.length > 0 && (
        <div className="py-8">
          <InviteDataTable data={inviteCodes} columns={inviteColumns} />
        </div>
      )}
    </div>
  );
};

const Members = () => {
  const { activeOrganization } = useGetActiveOrganization();

  const members = useQuery(
    api.inventory.organizationMembers.getAll,
    activeOrganization?._id
      ? { organizationId: activeOrganization._id }
      : "skip"
  );

  return (
    <div>
      {members && members.length > 0 && (
        <div className="py-8">
          <MembersDataTable data={members} columns={membersColumns} />
        </div>
      )}
    </div>
  );
};

const MemberForm = ({ onCancelClick }: { onCancelClick: () => void }) => {
  const [isAddingMember, setIsAddingMember] = useState(false);

  const form = useForm({
    resolver: zodResolver(organizationMemberSchema),
    defaultValues: { email: "", role: "admin" },
  });

  const createInviteCode = useMutation(api.inventory.inviteCode.create);

  const { user } = useAuth();
  const { activeOrganization } = useGetActiveOrganization();

  const onSubmit = async (data: z.infer<typeof organizationMemberSchema>) => {
    setIsAddingMember(true);
    try {
      const res = await createInviteCode({
        organizationId: activeOrganization?._id!,
        recipientEmail: data.email,
        role: "admin",
        createdByUserId: user?._id!,
      });

      if (res.success) {
        toast.success("Member added successfully");
      } else {
        toast.error(res.message);
      }

      onCancelClick();
    } catch (e) {
      toast.error("Failed to add member", {
        description: (e as Error).message,
      });
    } finally {
      setIsAddingMember(false);
    }
  };

  const roles = [
    { label: "Admin", value: "admin" },
    { label: "Member", value: "member" },
  ];

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-4"
      >
        <div className="w-[400px]">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground text-xs">
                  Email
                </FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
        </div>

        {/* <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-muted-foreground text-xs">
                Role
              </FormLabel>
              <Select
                onValueChange={(role) => {
                  field.onChange(role);
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        /> */}

        <div className="flex items-center gap-4">
          <LoadingButton
            variant={"outline"}
            className="w-[80px]"
            isLoading={isAddingMember}
          >
            Add
          </LoadingButton>

          <Button variant={"ghost"} type="button" onClick={onCancelClick}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
};

export const OrganizationMembersView = () => {
  const [showMemberForm, setShowMemberForm] = useState(false);

  return (
    <View hideBorder hideHeaderBottomBorder header={<Header />}>
      <div className="container mx-auto h-full w-full py-8 grid grid-cols-2 gap-40">
        <div className="space-y-8">
          <Members />
          {showMemberForm && (
            <div>
              <MemberForm onCancelClick={() => setShowMemberForm(false)} />
            </div>
          )}
          {!showMemberForm && (
            <Button variant={"ghost"} onClick={() => setShowMemberForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Member
            </Button>
          )}
        </div>

        <Invites />
      </div>
    </View>
  );
};
