import { type FC } from "react";
import type { VisualLayoutId } from "@/lib/visual-layouts";

type VisualDesignerProps = {
  activeLayoutId: VisualLayoutId;
  onLayoutChange: (layoutId: VisualLayoutId) => void;
};

export const VisualDesigner: FC<VisualDesignerProps> = ({ activeLayoutId, onLayoutChange }) => {
  void activeLayoutId;
  void onLayoutChange;
  return null;
};
