import { postAnalytics } from "@/api/analytics";
import { useMutation } from "@tanstack/react-query";

export const usePostAnalytics = () => {
  const { mutateAsync } = useMutation({
    mutationFn: postAnalytics,
  });

  return mutateAsync;
};
