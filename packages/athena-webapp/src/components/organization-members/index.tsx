import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { PageLevelHeader, PageWorkspace } from "../common/PageLevelHeader";
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
import { useState } from "react";
import { LoadingButton } from "../ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useAuth } from "~/src/hooks/useAuth";
import { useGetActiveOrganization } from "~/src/hooks/useGetOrganizations";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { toast } from "sonner";
import { InviteDataTable } from "./invites-table/components/data-table";
import { inviteColumns } from "./invites-table/components/inviteColumns";
import { MembersDataTable } from "./members-table/components/data-table";
import { membersColumns } from "./members-table/components/membersColumns";
import { StaffManagement } from "../staff";
import { presentUnexpectedErrorToast } from "~/src/lib/errors/presentUnexpectedErrorToast";

const organizationMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["full_admin", "pos_only"]),
});

const SectionHeader = ({
  description,
  title,
}: {
  description: string;
  title: string;
}) => {
  return (
    <div className="space-y-1.5 border-b border-border/70 pb-layout-md">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        {description}
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
      : "skip",
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
      : "skip",
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
    defaultValues: { email: "", role: "full_admin" as const },
  });

  const createInviteCode = useMutation(api.inventory.inviteCode.create);

  const { user } = useAuth();
  const { activeOrganization } = useGetActiveOrganization();

  const onSubmit = async (data: z.infer<typeof organizationMemberSchema>) => {
    if (!activeOrganization?._id || !user?._id) {
      toast.error("Member invite requires an active organization and user");
      return;
    }

    setIsAddingMember(true);
    try {
      const res = await createInviteCode({
        organizationId: activeOrganization._id,
        recipientEmail: data.email,
        role: data.role,
        createdByUserId: user._id,
      });

      if (res.success) {
        toast.success("Member added successfully");
      } else {
        toast.error(res.message);
      }

      onCancelClick();
    } catch {
      presentUnexpectedErrorToast("Failed to add member");
    } finally {
      setIsAddingMember(false);
    }
  };

  const roles = [
    { label: "Full Admin", value: "full_admin" },
    { label: "POS Only", value: "pos_only" },
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

        <div className="w-[400px]">
          <FormField
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
          />
        </div>

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
  const { activeOrganization } = useGetActiveOrganization();
  const { activeStore } = useGetActiveStore();

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Team access"
            showBackButton
            title="Members"
            description="Review organization members, pending invites, and store staff profiles before assigning operational access."
          />

          <section className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
            <SectionHeader
              title="Organization members"
              description="Manage admin access and pending invites for the organization."
            />

            <div className="grid gap-layout-2xl xl:grid-cols-2">
              <div className="space-y-layout-xl">
                <Members />
                {showMemberForm && (
                  <div>
                    <MemberForm
                      onCancelClick={() => setShowMemberForm(false)}
                    />
                  </div>
                )}
                {!showMemberForm && (
                  <Button
                    variant={"ghost"}
                    onClick={() => setShowMemberForm(true)}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Member
                  </Button>
                )}
              </div>

              <Invites />
            </div>
          </section>

          {activeStore && activeOrganization && (
            <section className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
              <SectionHeader
                title="Staff"
                description="Manage store staff profiles and the credentials used in POS, services, and cash controls."
              />
              <StaffManagement
                storeId={activeStore._id}
                organizationId={activeOrganization._id}
              />
            </section>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
};
