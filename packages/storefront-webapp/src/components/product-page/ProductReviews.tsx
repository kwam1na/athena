export function Reviews() {
  return null;
  return (
    <div className="space-y-4">
      <p>Reviews</p>

      <div>
        <p className="text-sm text-muted-foreground">
          This product has no reviews
        </p>
      </div>

      {/* <div className="space-y-16">
        <ProductReview />
        <ProductReview />
        <ProductReview />
      </div> */}
    </div>
  );
}

export function ProductReview() {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="bg-gray-100 rounded-md w-full h-[24px]"></div>
        <div className="bg-gray-100 rounded-md w-full h-[80px]"></div>
      </div>
      <div className="bg-gray-100 rounded-md w-[80%] h-[24px]"></div>
    </div>
  );
}
