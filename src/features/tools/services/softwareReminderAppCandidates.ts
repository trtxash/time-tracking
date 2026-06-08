import { ClassificationService } from "../../classification/services/classificationService.ts";
import type { ObservedAppCandidate } from "../../classification/types.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { ToolSoftwareReminderAppCandidate } from "../../../shared/types/tools.ts";

function resolveCandidateDisplayName(candidate: ObservedAppCandidate, exeName: string) {
  const mapped = AppClassification.mapApp(exeName, { appName: candidate.appName });
  return mapped.name.trim() || candidate.appName.trim() || exeName;
}

export function buildSoftwareReminderAppCandidates(
  observed: readonly ObservedAppCandidate[],
): ToolSoftwareReminderAppCandidate[] {
  const merged = new Map<string, ToolSoftwareReminderAppCandidate>();

  for (const candidate of observed) {
    if (!AppClassification.shouldTrackProcess(candidate.exeName, { appName: candidate.appName })) {
      continue;
    }

    const exeName = AppClassification.resolveCanonicalExecutable(candidate.exeName);
    if (!exeName || !AppClassification.shouldTrackApp(exeName)) {
      continue;
    }

    const appName = resolveCandidateDisplayName(candidate, exeName);
    const lastSeenAt = Math.max(0, Number(candidate.lastSeenMs ?? 0));
    const existing = merged.get(exeName);
    if (!existing) {
      merged.set(exeName, {
        appName,
        exeName,
        lastSeenAt,
      });
      continue;
    }

    existing.lastSeenAt = Math.max(existing.lastSeenAt, lastSeenAt);
    existing.appName = appName;
  }

  return Array.from(merged.values())
    .sort((left, right) => (
      right.lastSeenAt - left.lastSeenAt
      || left.appName.localeCompare(right.appName, undefined, { numeric: true, sensitivity: "base" })
      || left.exeName.localeCompare(right.exeName, undefined, { numeric: true, sensitivity: "base" })
    ));
}

export async function loadSoftwareReminderAppCandidates(): Promise<ToolSoftwareReminderAppCandidate[]> {
  const bootstrap = await ClassificationService.loadClassificationBootstrap();
  ClassificationService.applyBootstrapToProcessMapper(bootstrap);
  return buildSoftwareReminderAppCandidates(bootstrap.observed);
}
