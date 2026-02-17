export const LAYOUT_STORAGE_KEY = "pluribus-active-layout";

export const VISUAL_LAYOUTS = [
  {
    id: "carbon",
    name: "Carbon",
    vibe: "Focused developer workspace",
    description: "Single dark layout with sidebar, thread canvas, and notes panel.",
    accent: "#e8a849",
  },
] as const;

export type VisualLayout = (typeof VISUAL_LAYOUTS)[number];
export type VisualLayoutId = VisualLayout["id"];

export const DEFAULT_LAYOUT_ID: VisualLayoutId = "carbon";

const layoutIdSet = new Set<VisualLayoutId>(VISUAL_LAYOUTS.map((layout) => layout.id));

export function isVisualLayoutId(value: string): value is VisualLayoutId {
  return layoutIdSet.has(value as VisualLayoutId);
}

export function getVisualLayout(layoutId: VisualLayoutId): VisualLayout {
  return VISUAL_LAYOUTS.find((layout) => layout.id === layoutId) ?? VISUAL_LAYOUTS[0];
}
