import { create } from "zustand";
import { API } from "@/api";
import type { Asset, AssetType } from "@/types/asset";

interface AssetsStore {
  byType: Record<AssetType, Asset[]>;
  loadList: (type: AssetType, q?: string) => Promise<void>;
  addAsset: (asset: Asset) => void;
  updateAsset: (asset: Asset) => void;
  deleteAsset: (id: string, type: AssetType) => Promise<void>;
}

const LIST_PAGE_SIZE = 200;

export const useAssetsStore = create<AssetsStore>((set) => ({
  byType: { character: [], scene: [], prop: [] },
  loadList: async (type, q) => {
    // 后端 list 默认 limit=100；资产库页需要完整列表，按页拉到空页为止。
    const items: Asset[] = [];
    let offset = 0;
    for (;;) {
      const res = await API.listAssets({ type, q, limit: LIST_PAGE_SIZE, offset });
      items.push(...res.items);
      if (res.items.length < LIST_PAGE_SIZE) break;
      offset += LIST_PAGE_SIZE;
    }
    set((s) => ({ byType: { ...s.byType, [type]: items } }));
  },
  addAsset: (asset) =>
    set((s) => ({
      byType: { ...s.byType, [asset.type]: [asset, ...s.byType[asset.type]] },
    })),
  updateAsset: (asset) =>
    set((s) => ({
      byType: {
        ...s.byType,
        [asset.type]: s.byType[asset.type].map((a) => (a.id === asset.id ? asset : a)),
      },
    })),
  deleteAsset: async (id, type) => {
    await API.deleteAsset(id);
    set((s) => ({
      byType: { ...s.byType, [type]: s.byType[type].filter((a) => a.id !== id) },
    }));
  },
}));
