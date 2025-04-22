export const WebpImage = ({
  srcFallback,
  alt,
  ...props
}: {
  srcFallback?: string;
  alt: string;
} & React.ImgHTMLAttributes<HTMLImageElement>) => (
  <picture>
    <source srcSet={props.src} type="image/webp" />
    <img src={props.src} alt={alt} {...props} />
  </picture>
);
