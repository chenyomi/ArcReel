/** 从「题材-编号」命名里取出题材前缀；无分隔符则整名作为一类。 */
export function assetPackCategory(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const dash = trimmed.indexOf("-");
  if (dash <= 0) return trimmed;
  return trimmed.slice(0, dash);
}
