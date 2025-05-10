import { Star } from "lucide-react";

interface RatingStarsProps {
  rating: number;
  maxRating?: number;
  className?: string;
}

export function RatingStars({
  rating,
  maxRating = 5,
  className = "",
}: RatingStarsProps) {
  return (
    <div className={`flex items-center ${className}`}>
      {[...Array(maxRating)].map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i < rating ? "text-yellow-400 fill-yellow-400" : "text-slate-200"
          }`}
        />
      ))}
    </div>
  );
}
