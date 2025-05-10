import { AnimatePresence, motion } from "framer-motion";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { LoadingButton } from "../ui/loading-button";
import { RatingSelector } from "./RatingSelector";
import { ReviewFormData } from "./types";

interface ReviewFormProps {
  isHair: boolean;
  formData: ReviewFormData;
  onFormDataChange: (
    field: keyof ReviewFormData,
    value: string | number
  ) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
  hasUserReviewedProduct: boolean;
}

export const ReviewForm = ({
  isHair,
  formData,
  onFormDataChange,
  isSubmitting,
  onSubmit,
  hasUserReviewedProduct,
}: ReviewFormProps) => {
  const isFormValid =
    formData.title.trim() !== "" &&
    (isHair
      ? formData.hairQuality > 0 &&
        formData.trueToLength > 0 &&
        formData.capFit > 0 &&
        formData.styleAppearance > 0 &&
        formData.easeOfInstallation > 0
      : formData.overall > 0 && formData.value > 0 && formData.quality > 0);

  return (
    <>
      {!hasUserReviewedProduct && (
        <>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Title <span className="text-red-500">*</span>
            </p>
            <Input
              value={formData.title}
              onChange={(e) => onFormDataChange("title", e.target.value)}
              placeholder="Your title here"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Tell us more (optional)
            </p>
            <Textarea
              className="h-32 sm:h-40"
              value={formData.content}
              onChange={(e) => onFormDataChange("content", e.target.value)}
              placeholder="Share your thoughts here"
            />
          </div>

          <div className="space-y-8">
            {isHair ? (
              <>
                <RatingSelector
                  label="Hair Quality"
                  value={formData.hairQuality}
                  onChange={(value) => onFormDataChange("hairQuality", value)}
                />
                <RatingSelector
                  label="True to Length"
                  value={formData.trueToLength}
                  onChange={(value) => onFormDataChange("trueToLength", value)}
                />
                <RatingSelector
                  label="Cap Fit / Comfort"
                  value={formData.capFit}
                  onChange={(value) => onFormDataChange("capFit", value)}
                />
                <RatingSelector
                  label="Style / Appearance"
                  value={formData.styleAppearance}
                  onChange={(value) =>
                    onFormDataChange("styleAppearance", value)
                  }
                />
                <RatingSelector
                  label="Ease of Installation"
                  value={formData.easeOfInstallation}
                  onChange={(value) =>
                    onFormDataChange("easeOfInstallation", value)
                  }
                />
              </>
            ) : (
              <>
                <RatingSelector
                  label="Overall"
                  value={formData.overall}
                  onChange={(value) => onFormDataChange("overall", value)}
                />
                <RatingSelector
                  label="Value"
                  value={formData.value}
                  onChange={(value) => onFormDataChange("value", value)}
                />
                <RatingSelector
                  label="Quality"
                  value={formData.quality}
                  onChange={(value) => onFormDataChange("quality", value)}
                />
              </>
            )}
          </div>

          <div style={{ minHeight: 44 }} className="flex items-center gap-4">
            <AnimatePresence>
              {isFormValid && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <LoadingButton isLoading={isSubmitting} onClick={onSubmit}>
                    Submit review
                  </LoadingButton>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </>
  );
};
