import { describe, expect, it } from "vitest";
import { assetPackCategory } from "./assetPackCategory";

describe("assetPackCategory", () => {
  it("takes the segment before the first dash", () => {
    expect(assetPackCategory("现代都市-001")).toBe("现代都市");
    expect(assetPackCategory("古代言情-主角色-012")).toBe("古代言情");
  });

  it("returns the whole name when there is no dash", () => {
    expect(assetPackCategory("秦明")).toBe("秦明");
  });

  it("ignores leading/trailing whitespace", () => {
    expect(assetPackCategory("  仙侠玄幻-003  ")).toBe("仙侠玄幻");
  });
});
