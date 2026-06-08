import { AlarmClock, BellRing, TimerReset } from "lucide-react";
import type { ReactNode } from "react";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import type { ToolAlert } from "../../../shared/types/tools.ts";
import { useToolAlerts } from "../hooks/useToolAlerts.ts";

function formatAlertTime(timestampMs: number) {
  return new Date(timestampMs).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function alertIcon(alert: ToolAlert): ReactNode {
  if (alert.kind === "countdown") return <TimerReset size={17} />;
  if (alert.kind === "pomodoro") return <AlarmClock size={17} />;
  return <BellRing size={17} />;
}

export default function ToolAlertDialog() {
  const { activeAlert, dismissActiveAlert } = useToolAlerts();
  const title = activeAlert?.title.trim() || UI_TEXT.tools.notificationStatus;
  const message = activeAlert?.body.trim() || UI_TEXT.tools.defaultReminderLabel;
  const occurredAtLabel = activeAlert
    ? UI_TEXT.tools.alertOccurredAt(formatAlertTime(activeAlert.occurredAt))
    : "";

  return (
    <QuietDialog
      open={Boolean(activeAlert)}
      title={title}
      closeOnBackdrop={false}
      onClose={dismissActiveAlert}
      surfaceClassName="tools-alert-dialog-surface"
      actions={(
        <button
          type="button"
          className="qp-button-primary qp-dialog-action"
          onClick={dismissActiveAlert}
        >
          {UI_TEXT.tools.alertDismiss}
        </button>
      )}
    >
      {activeAlert && (
        <div className="tools-alert-dialog-body">
          <div className="tools-alert-dialog-icon" aria-hidden="true">
            {alertIcon(activeAlert)}
          </div>
          <div className="tools-alert-dialog-copy">
            <p className="tools-alert-dialog-message">{message}</p>
            <p className="tools-alert-dialog-time">{occurredAtLabel}</p>
          </div>
        </div>
      )}
    </QuietDialog>
  );
}
