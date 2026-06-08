import { useEffect, useMemo, useState } from "react";
import type { ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import { buildToolsViewModelLabels } from "../services/toolsLabels.ts";
import { ToolsRuntimeService } from "../services/toolsRuntimeService.ts";
import { buildToolsStatusChipViewModel } from "../services/toolsViewModel.ts";
import type { ToolsOpenTarget } from "../types.ts";
import ToolsStatusChip from "./ToolsStatusChip.tsx";

interface ToolsSidebarStatusEntryProps {
  onOpenSection: (target: ToolsOpenTarget) => void;
}

export default function ToolsSidebarStatusEntry({
  onOpenSection,
}: ToolsSidebarStatusEntryProps) {
  const [snapshot, setSnapshot] = useState<ToolsRuntimeSnapshot | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void ToolsRuntimeService.getToolsSnapshot()
      .then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((error) => {
        console.warn("load tools runtime snapshot failed", error);
      });

    void ToolsRuntimeService.onToolsRuntimeChanged((nextSnapshot) => {
      if (!cancelled) {
        setSnapshot(nextSnapshot);
      }
    })
      .then((dispose) => {
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("listen tools runtime snapshot failed", error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const statusChip = useMemo(() => (
    snapshot
      ? buildToolsStatusChipViewModel(snapshot, nowMs, buildToolsViewModelLabels())
      : null
  ), [nowMs, snapshot]);

  if (!statusChip) {
    return null;
  }

  return (
    <ToolsStatusChip
      label={statusChip.label}
      onClick={() => onOpenSection({
        section: statusChip.targetSection,
        timerMode: statusChip.targetTimerMode,
      })}
      className="tools-status-chip-sidebar"
    />
  );
}
