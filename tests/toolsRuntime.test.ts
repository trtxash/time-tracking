import assert from "node:assert/strict";
import {
  buildPomodoroViewModel,
  buildReminderRows,
  buildSoftwareReminderRuleRows,
  buildTimerViewModel,
  buildToolsStatusChipViewModel,
} from "../src/features/tools/services/toolsViewModel.ts";
import { buildSoftwareReminderAppCandidates } from "../src/features/tools/services/softwareReminderAppCandidates.ts";
import {
  parseToolAlert,
  parseToolAlerts,
  parseToolsRuntimeSnapshot,
} from "../src/platform/runtime/toolsRawDtos.ts";
import { createToolsRuntimeGateway } from "../src/platform/runtime/toolsRuntimeGateway.ts";
import type { ToolsRuntimeSnapshot } from "../src/shared/types/tools.ts";
import type { ToolsViewModelLabels } from "../src/features/tools/types.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import {
  readToolsReminderFormMode,
  readToolsReminderMode,
  readToolsTimerMode,
  rememberToolsReminderFormMode,
  rememberToolsReminderMode,
  rememberToolsTimerMode,
} from "../src/features/tools/services/toolsLayoutPreferenceStorage.ts";

const labels: ToolsViewModelLabels = {
  timerIdle: "Not started",
  timerRunning: "Running",
  timerPaused: "Paused",
  timerCompleted: "Completed",
  pomodoroFocus: "Focus",
  pomodoroShortBreak: "Short break",
  pomodoroLongBreak: "Long break",
  chipFocus: "Focus",
  chipBreak: "Break",
  chipCountdown: "Countdown",
  chipStopwatch: "Timer",
  chipReminder: "Reminder",
  softwareReminderActive: "Active",
  softwareReminderDailyLimit: (minutes) => `${minutes} min daily`,
  dueNow: "Now",
  completedToday: (count) => `${count} completed today`,
  cycle: (index, every) => `${index}/${every}`,
};

function rawSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      default_countdown_minutes: 25,
      pomodoro_focus_minutes: 25,
      pomodoro_short_break_minutes: 5,
      pomodoro_long_break_minutes: 15,
      pomodoro_long_break_every: 4,
    },
    reminders: [
      {
        id: 1,
        label: "Stand up",
        scheduled_at: 2_000_000,
        created_at: 1_000_000,
        status: "scheduled",
        fired_at: null,
        cancelled_at: null,
      },
    ],
    software_reminder_rules: [],
    current_timer: null,
    timer_laps: [],
    current_pomodoro: null,
    today_completed_pomodoros: 0,
    next_reminder_at: 2_000_000,
    sampled_at_ms: 1_000_000,
    ...overrides,
  };
}

function rawAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: "reminder:1",
    kind: "reminder",
    title: "提醒",
    body: "Stand up",
    occurred_at: 2_000_000,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ToolsRuntimeSnapshot> = {}): ToolsRuntimeSnapshot {
  return {
    settings: {
      defaultCountdownMinutes: 25,
      pomodoroFocusMinutes: 25,
      pomodoroShortBreakMinutes: 5,
      pomodoroLongBreakMinutes: 15,
      pomodoroLongBreakEvery: 4,
    },
    reminders: [],
    softwareReminderRules: [],
    currentTimer: null,
    timerLaps: [],
    currentPomodoro: null,
    todayCompletedPomodoros: 0,
    nextReminderAt: null,
    sampledAtMs: 1_000_000,
    ...overrides,
  };
}

let passed = 0;

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function withWindowStorage(storage: MemoryStorage, fn: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
}

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("raw tools snapshot maps snake_case fields to frontend models", () => {
  const parsed = parseToolsRuntimeSnapshot(rawSnapshot());

  assert.equal(parsed.settings.defaultCountdownMinutes, 25);
  assert.equal(parsed.reminders[0].scheduledAt, 2_000_000);
  assert.equal(parsed.nextReminderAt, 2_000_000);
});

await runTest("software reminder rules map and build rows", () => {
  const parsed = parseToolsRuntimeSnapshot(rawSnapshot({
    software_reminder_rules: [
      {
        id: 7,
        app_name: "Editor",
        exe_name: "editor.exe",
        limit_ms: 300 * 60_000,
        message: "Break",
        created_at: 1_000_000,
        updated_at: 1_000_000,
        disabled_at: null,
        last_fired_date_key: null,
      },
    ],
  }));
  const rows = buildSoftwareReminderRuleRows(parsed, labels);

  assert.equal(parsed.softwareReminderRules[0].appName, "Editor");
  assert.equal(rows[0].appLabel, "Editor");
  assert.equal(rows[0].limitLabel, "300 min daily");
  assert.equal(rows[0].statusLabel, "Active");
});

await runTest("software reminder app candidates reuse app mapping display names and tracking filters", () => {
  ProcessMapper.clearUserOverrides();
  try {
    ProcessMapper.setUserOverrides({
      "cursor.exe": {
        category: "development",
        displayName: "Work Editor",
        enabled: true,
      },
      "vlc.exe": {
        enabled: true,
        track: false,
      },
    });

    const candidates = buildSoftwareReminderAppCandidates([
      {
        appName: "Cursor Raw",
        exeName: "cursor.exe",
        totalDuration: 120_000,
        lastSeenMs: 2_000_000,
      },
      {
        appName: "VLC Raw",
        exeName: "vlc.exe",
        totalDuration: 120_000,
        lastSeenMs: 3_000_000,
      },
      {
        appName: "Task Manager",
        exeName: "taskmgr.exe",
        totalDuration: 120_000,
        lastSeenMs: 4_000_000,
      },
      {
        appName: "Obsidian Setup",
        exeName: "obsidian-setup.exe",
        totalDuration: 120_000,
        lastSeenMs: 5_000_000,
      },
      {
        appName: "Chrome Raw",
        exeName: "chrome.exe",
        totalDuration: 120_000,
        lastSeenMs: 1_000_000,
      },
    ]);

    assert.deepEqual(
      candidates.map((candidate) => `${candidate.appName}:${candidate.exeName}`),
      [
        "Work Editor:cursor.exe",
        "Google Chrome:chrome.exe",
      ],
    );
    assert.equal(candidates[0].lastSeenAt, 2_000_000);
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

await runTest("software reminder rule rows use mapped display names for saved executables", () => {
  ProcessMapper.clearUserOverrides();
  try {
    ProcessMapper.setUserOverrides({
      "cursor.exe": {
        category: "development",
        displayName: "Writing IDE",
        enabled: true,
      },
    });

    const rows = buildSoftwareReminderRuleRows(snapshot({
      softwareReminderRules: [
        {
          id: 9,
          appName: "Cursor Raw",
          exeName: "cursor.exe",
          limitMs: 45 * 60_000,
          message: "Switch context",
          createdAt: 1_000_000,
          updatedAt: 1_000_000,
          disabledAt: null,
          lastFiredDateKey: null,
        },
      ],
    }), labels);

    assert.equal(rows[0].appLabel, "Writing IDE");
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

await runTest("software reminder app candidates merge canonical executable aliases", () => {
  const candidates = buildSoftwareReminderAppCandidates([
    {
      appName: "Alma",
      exeName: "alma-0.0.750-win-x64.exe",
      totalDuration: 60_000,
      lastSeenMs: 1_000_000,
    },
    {
      appName: "Alma",
      exeName: "alma.exe",
      totalDuration: 60_000,
      lastSeenMs: 2_000_000,
    },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].appName, "Alma");
  assert.equal(candidates[0].exeName, "alma.exe");
  assert.equal(candidates[0].lastSeenAt, 2_000_000);
});

await runTest("raw tools snapshot rejects missing fields and illegal status values", () => {
  assert.throws(() => parseToolsRuntimeSnapshot({ reminders: [] }), /invalid tools runtime snapshot/);
  assert.throws(
    () => parseToolsRuntimeSnapshot(rawSnapshot({
      reminders: [{
        id: 1,
        label: "Bad",
        scheduled_at: 2_000,
        created_at: 1_000,
        status: "waiting",
        fired_at: null,
        cancelled_at: null,
      }],
    })),
    /invalid tools runtime snapshot/,
  );
});

await runTest("raw tool alerts map snake_case fields and reject invalid kinds", () => {
  const parsed = parseToolAlert(rawAlert());
  const list = parseToolAlerts([rawAlert({ id: "reminder:2" })]);

  assert.equal(parsed.occurredAt, 2_000_000);
  assert.equal(list[0].id, "reminder:2");
  assert.throws(() => parseToolAlert(rawAlert({ kind: "system" })), /invalid tool alert/);
});

await runTest("reminder snapshot builds reminder rows", () => {
  const rows = buildReminderRows(parseToolsRuntimeSnapshot(rawSnapshot()), 1_940_000, labels);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Stand up");
  assert.equal(rows[0].remainingLabel, "01:00");
  assert.equal(rows[0].canCancel, true);
});

await runTest("reminder rows only include pending reminders", () => {
  const rows = buildReminderRows(snapshot({
    reminders: [
      {
        id: 1,
        label: "Keep me",
        scheduledAt: 2_000_000,
        createdAt: 1_000_000,
        status: "scheduled",
        firedAt: null,
        cancelledAt: null,
      },
      {
        id: 2,
        label: "Cancelled",
        scheduledAt: 2_000_000,
        createdAt: 1_000_000,
        status: "cancelled",
        firedAt: null,
        cancelledAt: 1_500_000,
      },
      {
        id: 3,
        label: "Fired",
        scheduledAt: 1_900_000,
        createdAt: 1_000_000,
        status: "fired",
        firedAt: 1_900_000,
        cancelledAt: null,
      },
    ],
  }), 1_940_000, labels);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Keep me");
});

await runTest("timer view model formats stopwatch elapsed and countdown remaining", () => {
  const stopwatch = buildTimerViewModel(snapshot({
    currentTimer: {
      id: 1,
      mode: "stopwatch",
      label: null,
      durationMs: null,
      accumulatedMs: 5_000,
      startedAt: 10_000,
      pausedAt: null,
      completedAt: null,
      status: "running",
      createdAt: 9_000,
      updatedAt: 10_000,
    },
  }), 18_000, labels);
  const countdown = buildTimerViewModel(snapshot({
    currentTimer: {
      id: 2,
      mode: "countdown",
      label: null,
      durationMs: 30_000,
      accumulatedMs: 10_000,
      startedAt: 20_000,
      pausedAt: null,
      completedAt: null,
      status: "running",
      createdAt: 19_000,
      updatedAt: 20_000,
    },
  }), 25_000, labels);

  assert.equal(stopwatch.displayTime, "00:00:13");
  assert.equal(countdown.displayTime, "00:00:15");
});

await runTest("pomodoro view model formats phase and daily count", () => {
  const viewModel = buildPomodoroViewModel(snapshot({
    currentPomodoro: {
      id: 1,
      phase: "short_break",
      status: "paused",
      cycleIndex: 2,
      focusMs: 25 * 60_000,
      shortBreakMs: 5 * 60_000,
      longBreakMs: 15 * 60_000,
      longBreakEvery: 4,
      phaseStartedAt: null,
      phasePausedAt: 2_000,
      phaseRemainingMs: 4 * 60_000,
      completedFocusCount: 1,
      createdAt: 1_000,
      updatedAt: 2_000,
    },
    todayCompletedPomodoros: 3,
  }), 3_000, labels);

  assert.equal(viewModel.phaseLabel, "Short break");
  assert.equal(viewModel.remainingLabel, "00:04:00");
  assert.equal(viewModel.todayCompletedLabel, "3 completed today");
});

await runTest("tools status chip priority prefers pomodoro then timer then reminder", () => {
  const reminderOnly = buildToolsStatusChipViewModel(snapshot({ nextReminderAt: 2_000_000 }), 1_000_000, labels);
  const countdown = buildToolsStatusChipViewModel(snapshot({
    nextReminderAt: 2_000_000,
    currentTimer: {
      id: 1,
      mode: "countdown",
      label: null,
      durationMs: 60_000,
      accumulatedMs: 0,
      startedAt: 1_000_000,
      pausedAt: null,
      completedAt: null,
      status: "running",
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    },
  }), 1_010_000, labels);
  const pomodoro = buildToolsStatusChipViewModel(snapshot({
    currentTimer: countdown ? {
      id: 1,
      mode: "stopwatch",
      label: null,
      durationMs: null,
      accumulatedMs: 0,
      startedAt: 1_000_000,
      pausedAt: null,
      completedAt: null,
      status: "running",
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    } : null,
    currentPomodoro: {
      id: 2,
      phase: "focus",
      status: "running",
      cycleIndex: 1,
      focusMs: 25 * 60_000,
      shortBreakMs: 5 * 60_000,
      longBreakMs: 15 * 60_000,
      longBreakEvery: 4,
      phaseStartedAt: 1_000_000,
      phasePausedAt: null,
      phaseRemainingMs: 25 * 60_000,
      completedFocusCount: 0,
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    },
    nextReminderAt: 2_000_000,
  }), 1_010_000, labels);

  assert.equal(reminderOnly?.targetSection, "reminders");
  assert.equal(reminderOnly?.targetTimerMode, undefined);
  assert.match(countdown?.label ?? "", /^Countdown/);
  assert.equal(countdown?.targetSection, "timer");
  assert.equal(countdown?.targetTimerMode, "countdown");
  assert.equal(pomodoro?.targetSection, "pomodoro");
  assert.equal(pomodoro?.targetTimerMode, undefined);
  assert.match(pomodoro?.label ?? "", /^Focus/);
});

await runTest("tools segmented mode preferences persist locally", () => {
  assert.equal(readToolsReminderMode(), "event");
  assert.equal(readToolsTimerMode(), "stopwatch");
  assert.equal(readToolsReminderFormMode(), "relative");

  withWindowStorage(new MemoryStorage(), () => {
    assert.equal(readToolsReminderMode(), "event");
    assert.equal(readToolsTimerMode(), "stopwatch");
    assert.equal(readToolsReminderFormMode(), "relative");

    rememberToolsReminderMode("software");
    rememberToolsTimerMode("countdown");
    rememberToolsReminderFormMode("absolute");

    assert.equal(readToolsReminderMode(), "software");
    assert.equal(readToolsTimerMode(), "countdown");
    assert.equal(readToolsReminderFormMode(), "absolute");

    window.localStorage.setItem("time-tracker:tools-reminder-mode", "timer");
    window.localStorage.setItem("time-tracker:tools-timer-mode", "timer");
    window.localStorage.setItem("time-tracker:tools-reminder-form-mode", "later");

    assert.equal(readToolsReminderMode(), "event");
    assert.equal(readToolsTimerMode(), "stopwatch");
    assert.equal(readToolsReminderFormMode(), "relative");
  });
});

await runTest("gateway invokes commands, parses event payloads, and disposes listeners", async () => {
  const calls: Array<{ command: string; payload?: Record<string, unknown> }> = [];
  let disposed = false;
  let emit: (() => void) | null = null;
  let emitAlert: (() => void) | null = null;
  let listenedEventName = "";
  let listenedAlertEventName = "";
  let received: ToolsRuntimeSnapshot | null = null;
  let receivedAlertId = "";

  const gateway = createToolsRuntimeGateway({
    async invoke(command, payload) {
      calls.push({ command, payload });
      if (command === "cmd_get_tool_alerts") {
        return [rawAlert()] as unknown;
      }
      if (command === "cmd_dismiss_tool_alert") {
        return undefined as unknown;
      }
      return rawSnapshot() as unknown;
    },
    async listen(eventName, handler) {
      if (eventName === "tools-alert") {
        listenedAlertEventName = eventName;
        emitAlert = () => handler({
          event: eventName,
          id: 2,
          payload: rawAlert({ id: "reminder:3" }),
          windowLabel: "main",
        });
      } else {
        listenedEventName = eventName;
        emit = () => handler({
          event: eventName,
          id: 1,
          payload: rawSnapshot({ next_reminder_at: 3_000_000 }),
          windowLabel: "main",
        });
      }
      return () => {
        disposed = true;
      };
    },
  });

  const firstSnapshot = await gateway.getToolsSnapshot();
  const alerts = await gateway.getToolAlerts();
  const dispose = await gateway.onToolsRuntimeChanged((nextSnapshot) => {
    received = nextSnapshot;
  });
  const disposeAlert = await gateway.onToolAlert((alert) => {
    receivedAlertId = alert.id;
  });
  emit?.();
  emitAlert?.();
  await gateway.dismissToolAlert("reminder:1");
  dispose();
  disposeAlert();

  assert.equal(calls[0].command, "cmd_get_tools_snapshot");
  assert.equal(firstSnapshot.nextReminderAt, 2_000_000);
  assert.equal(alerts[0].body, "Stand up");
  assert.deepEqual(calls[calls.length - 1], {
    command: "cmd_dismiss_tool_alert",
    payload: { alertId: "reminder:1" },
  });
  assert.equal(listenedEventName, "tools-runtime-changed");
  assert.equal(listenedAlertEventName, "tools-alert");
  assert.equal(received?.nextReminderAt, 3_000_000);
  assert.equal(receivedAlertId, "reminder:3");
  assert.equal(disposed, true);
});

console.log(`Passed ${passed} tools runtime tests`);
