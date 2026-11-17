import type { ExportEvent, ExportTournament } from './exports.service';
import { hostDisplayLabel, MIX_CATEGORY_LABELS, mixCategory, mixOriginLabel } from '../common/event-mix';

/**
 * 混编（见 common/event-mix.ts）在导出里的样子：
 * - 并入单项的报名合进主项目，每条标上原项目 mixOrigin（名次里的「原项目」列用）；
 * - 主项目改用混编名（label 为完整名称，groupLabel 置空，避免再拼一次组名）；
 *   不同项目混编（男单 + 女单）时场次号前缀用「单打 / 双打」；
 * - 并入单项本身从导出里去掉，它没有签表和场次。
 * 报名表、回导模板仍按原单项列出，不调用这里。
 */
export function applyEventMixes(tournament: ExportTournament): ExportTournament {
  const members = tournament.events.filter((event) => event.mixHostId);
  if (!members.length) return tournament;
  return {
    ...tournament,
    events: tournament.events
      .filter((event) => !event.mixHostId)
      .map((host) => {
        const own = members.filter((member) => member.mixHostId === host.id);
        if (!own.length) return host;
        const tag = (owner: ExportEvent) =>
          owner.registrations.map((registration) => ({ ...registration, mixOrigin: mixOriginLabel(owner) }));
        const sameType = own.every((member) => member.type === host.type);
        return {
          ...host,
          label: hostDisplayLabel({ ...host, mixMembers: own }),
          groupLabel: null,
          ...(sameType ? {} : { codePrefix: MIX_CATEGORY_LABELS[mixCategory(host.type)] }),
          registrations: [...tag(host), ...own.flatMap(tag)],
        };
      }),
  };
}

/** 有混编时名次表多一列「原项目」。 */
export function hasEventMix(tournament: { events: Array<{ registrations: Array<{ mixOrigin?: string | null }> }> }) {
  return tournament.events.some((event) => event.registrations.some((registration) => registration.mixOrigin));
}
