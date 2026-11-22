type ScheduledTeamItem = { scheduleLocked: boolean; scheduledAt: Date | null; venueId: string | null };

/** 同时开打、分别固定在两片场地的子项，视为同一批次。 */
export function areTeamItemsScheduledInParallel(first: ScheduledTeamItem, second: ScheduledTeamItem): boolean {
  return Boolean(first.scheduleLocked && second.scheduleLocked && first.venueId && second.venueId
    && first.venueId !== second.venueId && first.scheduledAt && second.scheduledAt
    && first.scheduledAt.getTime() === second.scheduledAt.getTime());
}

export function hasParallelTeamSchedule(items: readonly ScheduledTeamItem[]): boolean {
  return items.some((item, index) => items.slice(index + 1).some(other => areTeamItemsScheduledInParallel(item, other)));
}

export function teamScheduleTimeZone(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object' || !('timeZone' in settings) || typeof settings.timeZone !== 'string') return;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: settings.timeZone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
