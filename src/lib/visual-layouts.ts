export const LAYOUT_STORAGE_KEY = "pluribus-active-layout";

export const VISUAL_LAYOUTS = [
  {
    id: "atelier",
    name: "Atelier Grid",
    vibe: "Editorial split workspace",
    description: "A structured studio layout with side navigation, primary canvas, and utility strip.",
    accent: "#0b6dff",
  },
] as const;

export type VisualLayout = (typeof VISUAL_LAYOUTS)[number];
export type VisualLayoutId = VisualLayout["id"];

export const DEFAULT_LAYOUT_ID: VisualLayoutId = "atelier";

const layoutIdSet = new Set<VisualLayoutId>(VISUAL_LAYOUTS.map((layout) => layout.id));

export function isVisualLayoutId(value: string): value is VisualLayoutId {
  return layoutIdSet.has(value as VisualLayoutId);
}

export function getVisualLayout(layoutId: VisualLayoutId): VisualLayout {
  return VISUAL_LAYOUTS.find((layout) => layout.id === layoutId) ?? VISUAL_LAYOUTS[0];
}
