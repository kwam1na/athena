export function formatTaxonomySelectOptionLabel(name: string) {
  return name
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      if (!part) return part;
      if (part === part.toUpperCase() && /[A-Z]/.test(part)) return part;

      return part
        .split(/([-/])/)
        .map((segment) => {
          if (segment === "-" || segment === "/") return segment;
          if (!segment) return segment;
          if (segment === segment.toUpperCase() && /[A-Z]/.test(segment)) {
            return segment;
          }

          return `${segment.charAt(0).toUpperCase()}${segment
            .slice(1)
            .toLowerCase()}`;
        })
        .join("");
    })
    .join("");
}
