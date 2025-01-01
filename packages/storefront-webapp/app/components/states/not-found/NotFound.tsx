import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

export default function NotFound() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <p className="text-xl font-light">
          The page you're looking for does not exist
        </p>

        <div className="flex gap-4">
          <Button
            className="lg:w-[320px]"
            onClick={() => window.history.back()}
          >
            Take me back
          </Button>

          <Link to="/">
            <Button className="lg:w-[320px]" variant={"outline"}>
              Go to home page
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
