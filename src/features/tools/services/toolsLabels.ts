import { UI_TEXT, type UiText } from "../../../shared/copy/uiText.ts";
import type { ToolsViewModelLabels } from "../types.ts";

export function buildToolsViewModelLabels(uiText: UiText = UI_TEXT): ToolsViewModelLabels {
  return {
    timerIdle: uiText.tools.timerStatus.idle,
    timerRunning: uiText.tools.timerStatus.running,
    timerPaused: uiText.tools.timerStatus.paused,
    timerCompleted: uiText.tools.timerStatus.completed,
    pomodoroFocus: uiText.tools.pomodoroPhase.focus,
    pomodoroShortBreak: uiText.tools.pomodoroPhase.shortBreak,
    pomodoroLongBreak: uiText.tools.pomodoroPhase.longBreak,
    chipFocus: uiText.tools.statusChip.focus,
    chipBreak: uiText.tools.statusChip.break,
    chipCountdown: uiText.tools.statusChip.countdown,
    chipStopwatch: uiText.tools.statusChip.stopwatch,
    chipReminder: uiText.tools.statusChip.reminder,
    softwareReminderActive: uiText.tools.softwareReminderActive,
    softwareReminderDailyLimit: uiText.tools.softwareReminderDailyLimit,
    dueNow: uiText.tools.dueNow,
    completedToday: uiText.tools.completedToday,
    cycle: uiText.tools.pomodoroCycle,
  };
}
