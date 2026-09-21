import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAssetsStore } from "./assets-store";
import { API } from "@/api";

describe("useAssetsStore", () => {
  beforeEach(() => {
    useAssetsStore.setState({ byType: { character: [], scene: [], prop: [] } });
    vi.restoreAllMocks();
  });

  it("loads list by type", async () => {
    vi.spyOn(API, "listAssets" as any).mockResolvedValue({ items: [{ id: "1", type: "scene", name: "A", description: "", voice_style: "", image_path: null, audio_path: null, source_project: null, updated_at: null, derivatives: [] }] });
    await useAssetsStore.getState().loadList("scene");
    expect(useAssetsStore.getState().byType.scene).toHaveLength(1);
  });

  it("pages through listAssets until a short page", async () => {
    const page = (n: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${n}-${i}`,
        type: "character" as const,
        name: `C${n}-${i}`,
        description: "",
        voice_style: "",
        image_path: null,
        audio_path: null,
        source_project: null,
        updated_at: null,
        derivatives: [],
      }));
    const spy = vi
      .spyOn(API, "listAssets" as any)
      .mockResolvedValueOnce({ items: page(0, 200) })
      .mockResolvedValueOnce({ items: page(1, 200) })
      .mockResolvedValueOnce({ items: page(2, 50) });
    await useAssetsStore.getState().loadList("character");
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0]).toMatchObject({ type: "character", limit: 200, offset: 0 });
    expect(spy.mock.calls[1][0]).toMatchObject({ offset: 200 });
    expect(spy.mock.calls[2][0]).toMatchObject({ offset: 400 });
    expect(useAssetsStore.getState().byType.character).toHaveLength(450);
  });

  it("removes asset locally after delete", async () => {
    useAssetsStore.setState({ byType: { character: [], scene: [{ id: "1", type: "scene", name: "A", description: "", voice_style: "", image_path: null, audio_path: null, source_project: null, updated_at: null, derivatives: [] }], prop: [] } });
    vi.spyOn(API, "deleteAsset" as any).mockResolvedValue(undefined);
    await useAssetsStore.getState().deleteAsset("1", "scene");
    expect(useAssetsStore.getState().byType.scene).toHaveLength(0);
  });
});
