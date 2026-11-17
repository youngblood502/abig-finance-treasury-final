/** Keeps what a person typed as a plain number: digits and one point, with at most two decimals. */
export const plainAmount = (typed: string) => {
  const [whole, ...rest] = typed.replace(/[^\d.]/g, "").split(".");
  const digits = whole.replace(/^0+(?=\d)/, "");
  return rest.length === 0 ? digits : `${digits}.${rest.join("").slice(0, 2)}`;
};
/** The same number with thousands separators, keeping a decimal part that is still being typed. */
export const formatAmountInput = (plain: string) => {
  if (plain === "") return "";
  const [whole, decimals] = plain.split(".");
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimals === undefined ? grouped : `${grouped}.${decimals}`;
};
