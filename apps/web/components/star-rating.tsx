interface Props {
  rating: number;       // 0–5, fractional supported
  maxStars?: number;
  size?: "sm" | "md" | "lg";
  showValue?: boolean;
  reviewCount?: number;
}

const SIZES = { sm: "text-sm", md: "text-base", lg: "text-xl" };

export default function StarRating({
  rating,
  maxStars = 5,
  size = "md",
  showValue = false,
  reviewCount,
}: Props) {
  const stars = Array.from({ length: maxStars }, (_, i) => {
    const fill = Math.min(1, Math.max(0, rating - i));
    if (fill >= 0.75) return "full";
    if (fill >= 0.25) return "half";
    return "empty";
  });

  return (
    <span className={`inline-flex items-center gap-0.5 ${SIZES[size]}`}>
      {stars.map((type, i) => (
        <span key={i} className={type === "empty" ? "text-muted-foreground/30" : "text-amber-400"}>
          {type === "full" ? "★" : type === "half" ? "⯨" : "☆"}
        </span>
      ))}
      {showValue && (
        <span className="ml-1 text-sm font-medium tabular-nums">{rating.toFixed(1)}</span>
      )}
      {reviewCount !== undefined && (
        <span className="ml-1 text-xs text-muted-foreground">({reviewCount})</span>
      )}
    </span>
  );
}
