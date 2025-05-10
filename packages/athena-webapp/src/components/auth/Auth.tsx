import { Button } from "../ui/button";

export function Auth({
  actionText,
  onSubmit,
  status,
  afterSubmit,
}: {
  actionText: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  status: "pending" | "idle" | "success" | "error";
  afterSubmit?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-white flex items-start justify-center p-8">
      <div className="bg-white p-8 rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold mb-4">{actionText}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(e);
          }}
          className="space-y-4"
        >
          <Button>Login</Button>
        </form>
      </div>
    </div>
  );
}
