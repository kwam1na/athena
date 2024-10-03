import { Icons } from "./icons";

export default function Spinner() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <Icons.spinner className="h-8 w-8 text-muted-foreground animate-spin" />
    </div>
  );
}
