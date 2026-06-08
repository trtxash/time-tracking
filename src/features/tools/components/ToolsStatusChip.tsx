import { Wrench } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";

interface ToolsStatusChipProps {
  label: string;
  onClick: () => void;
  className?: string;
}

export default function ToolsStatusChip({
  label,
  onClick,
  className,
}: ToolsStatusChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={UI_TEXT.accessibility.tools.openStatusChip}
      className={`tools-status-chip ${className ?? ""}`.trim()}
    >
      <Wrench size={12} />
      <span>{label}</span>
    </button>
  );
}
