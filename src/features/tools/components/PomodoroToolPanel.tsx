import { AlarmClock, FastForward, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import type { StartPomodoroInput, ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import type { PomodoroViewModel } from "../types.ts";
import ToolDurationInput from "./ToolDurationInput.tsx";

interface PomodoroToolPanelProps {
  snapshot: ToolsRuntimeSnapshot;
  viewModel: PomodoroViewModel;
  busyAction: string | null;
  onStartPomodoro: (input?: Partial<StartPomodoroInput>) => Promise<void>;
  onPausePomodoro: () => Promise<void>;
  onResumePomodoro: () => Promise<void>;
  onSkipPomodoroPhase: () => Promise<void>;
  onResetPomodoro: () => Promise<void>;
}

export default function PomodoroToolPanel({
  snapshot,
  viewModel,
  busyAction,
  onStartPomodoro,
  onPausePomodoro,
  onResumePomodoro,
  onSkipPomodoroPhase,
  onResetPomodoro,
}: PomodoroToolPanelProps) {
  const [focusMinutes, setFocusMinutes] = useState(snapshot.settings.pomodoroFocusMinutes);
  const [shortBreakMinutes, setShortBreakMinutes] = useState(snapshot.settings.pomodoroShortBreakMinutes);
  const [longBreakMinutes, setLongBreakMinutes] = useState(snapshot.settings.pomodoroLongBreakMinutes);
  const [longBreakEvery, setLongBreakEvery] = useState(snapshot.settings.pomodoroLongBreakEvery);
  const run = snapshot.currentPomodoro;
  const status = run?.status ?? "idle";
  const isRunning = status === "running";
  const isPaused = status === "paused";
  const hasStarted = Boolean(run) && status !== "idle";
  const controlsDisabled = busyAction !== null;
  const cycleTotal = Math.max(1, Math.min(12, run?.longBreakEvery ?? longBreakEvery));
  const cycleIndex = Math.max(1, Math.min(cycleTotal, run?.cycleIndex ?? 1));
  const cycleMarkers = Array.from({ length: cycleTotal }, (_, index) => index + 1);

  useEffect(() => {
    if (!run || run.status === "idle") {
      setFocusMinutes(snapshot.settings.pomodoroFocusMinutes);
      setShortBreakMinutes(snapshot.settings.pomodoroShortBreakMinutes);
      setLongBreakMinutes(snapshot.settings.pomodoroLongBreakMinutes);
      setLongBreakEvery(snapshot.settings.pomodoroLongBreakEvery);
    }
  }, [
    run?.id,
    run?.status,
    snapshot.settings.pomodoroFocusMinutes,
    snapshot.settings.pomodoroLongBreakEvery,
    snapshot.settings.pomodoroLongBreakMinutes,
    snapshot.settings.pomodoroShortBreakMinutes,
  ]);

  const startInput: StartPomodoroInput = {
    focusMs: focusMinutes * 60_000,
    shortBreakMs: shortBreakMinutes * 60_000,
    longBreakMs: longBreakMinutes * 60_000,
    longBreakEvery,
  };

  return (
    <section className="tools-panel qp-panel">
      <div className="tools-panel-header">
        <div>
          <div className="tools-panel-title">
            <AlarmClock size={16} />
            <h2>{UI_TEXT.tools.pomodoroTitle}</h2>
          </div>
        </div>
      </div>

      <div className="tools-pomodoro-workbench">
        <div className="tools-pomodoro-display">
          <div className="tools-pomodoro-primary">
            <span className="tools-pomodoro-phase">{viewModel.phaseLabel}</span>
            <strong>{viewModel.remainingLabel}</strong>
          </div>
          <div className="tools-pomodoro-cycle-track" aria-hidden="true">
            {cycleMarkers.map((marker) => (
              <span
                key={marker}
                className={[
                  "tools-pomodoro-cycle-dot",
                  marker === cycleIndex ? "tools-pomodoro-cycle-dot-active" : "",
                  marker < cycleIndex ? "tools-pomodoro-cycle-dot-complete" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ))}
          </div>
          <div className="tools-pomodoro-metrics">
            <span>{viewModel.cycleLabel}</span>
            <span>{viewModel.todayCompletedLabel}</span>
          </div>
        </div>

        <div className="tools-action-row tools-pomodoro-actions">
          {!hasStarted || run?.status === "idle" || run?.status === "completed" ? (
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void onStartPomodoro(startInput)}
              aria-label={UI_TEXT.accessibility.tools.startPomodoro}
              className="qp-button-primary tools-action-button"
            >
              <Play size={14} />
              {UI_TEXT.tools.start}
            </button>
          ) : null}
          {isRunning ? (
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void onPausePomodoro()}
              aria-label={UI_TEXT.accessibility.tools.pausePomodoro}
              className="qp-button-secondary tools-action-button"
            >
              <Pause size={14} />
              {UI_TEXT.tools.pause}
            </button>
          ) : null}
          {isPaused ? (
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void onResumePomodoro()}
              aria-label={UI_TEXT.accessibility.tools.resumePomodoro}
              className="qp-button-primary tools-action-button"
            >
              <Play size={14} />
              {UI_TEXT.tools.resume}
            </button>
          ) : null}
          {hasStarted ? (
            <>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => void onSkipPomodoroPhase()}
                aria-label={UI_TEXT.accessibility.tools.skipPomodoroPhase}
                className="qp-button-secondary tools-action-button"
              >
                <FastForward size={14} />
                {UI_TEXT.tools.skipPhase}
              </button>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => void onResetPomodoro()}
                aria-label={UI_TEXT.accessibility.tools.resetPomodoro}
                className="qp-button-secondary tools-action-button"
              >
                <RotateCcw size={14} />
                {UI_TEXT.tools.reset}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="tools-subpanel tools-pomodoro-rules">
        <div className="tools-subpanel-header">
          <h3>{UI_TEXT.tools.pomodoroSettings}</h3>
        </div>
        <div className="tools-pomodoro-settings-grid">
          <ToolDurationInput
            id="tools-pomodoro-focus"
            label={UI_TEXT.tools.focusDuration}
            minutes={focusMinutes}
            minMinutes={1}
            maxMinutes={180}
            disabled={hasStarted}
            onMinutesChange={setFocusMinutes}
          />
          <ToolDurationInput
            id="tools-pomodoro-short-break"
            label={UI_TEXT.tools.shortBreakDuration}
            minutes={shortBreakMinutes}
            minMinutes={1}
            maxMinutes={60}
            disabled={hasStarted}
            onMinutesChange={setShortBreakMinutes}
          />
          <ToolDurationInput
            id="tools-pomodoro-long-break"
            label={UI_TEXT.tools.longBreakDuration}
            minutes={longBreakMinutes}
            minMinutes={1}
            maxMinutes={120}
            disabled={hasStarted}
            onMinutesChange={setLongBreakMinutes}
          />
          <ToolDurationInput
            id="tools-pomodoro-long-break-every"
            label={UI_TEXT.tools.longBreakEvery}
            minutes={longBreakEvery}
            minMinutes={2}
            maxMinutes={12}
            disabled={hasStarted}
            onMinutesChange={setLongBreakEvery}
          />
        </div>
      </div>
    </section>
  );
}
