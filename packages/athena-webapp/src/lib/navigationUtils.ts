export const getOrigin = () => {
  return encodeURIComponent(
    `${window.location.pathname}${window.location.search}`
  );
};
