import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LAYOUT_ID, type VisualLayoutId } from "@/lib/visual-layouts";

const VisualLayoutContext = createContext<VisualLayoutId>(DEFAULT_LAYOUT_ID);

type VisualLayoutProviderProps = {
  layoutId: VisualLayoutId;
  children: ReactNode;
};

export function VisualLayoutProvider({ layoutId, children }: VisualLayoutProviderProps) {
  return <VisualLayoutContext.Provider value={layoutId}>{children}</VisualLayoutContext.Provider>;
}

export function useVisualLayoutId() {
  return useContext(VisualLayoutContext) ?? DEFAULT_LAYOUT_ID;
}
