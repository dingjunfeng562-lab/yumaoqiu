import { applyEventMixes, hasEventMix } from './export-mix';

/** 导出里的混编：并入单项的选手合进主项目，主项目用混编名，并入单项本身不再单独出现。 */
describe('导出 applyEventMixes', () => {
  const registration = (id: string, eventId: string) => ({ id, eventId }) as any;
  const event = (id: string, type: string, groupLabel: string, mixHostId: string | null, ids: string[]) => ({
    id, type, groupLabel, mixHostId, registrations: ids.map((rid) => registration(rid, id)), matches: [],
  });

  it('没有混编时原样返回', () => {
    const tournament = { name: 'T', events: [event('a', 'MENS_SINGLES', '高一组', null, ['r1'])] } as any;
    expect(applyEventMixes(tournament)).toBe(tournament);
    expect(hasEventMix(tournament)).toBe(false);
  });

  it('同一种项目：合并名单、混编名、场次号前缀不变', () => {
    const result = applyEventMixes({
      name: 'T',
      events: [
        event('host', 'MENS_SINGLES', '高一组', null, ['r1']),
        event('m1', 'MENS_SINGLES', '高二高三组', 'host', ['r2']),
        event('w', 'WOMENS_SINGLES', '高一组', null, ['r3']),
      ],
    } as any);
    expect(result.events.map((item) => item.id)).toEqual(['host', 'w']);
    const host = result.events[0];
    expect(host.label).toBe('混编（高一组+高二高三组） · 男子单打');
    expect(host.groupLabel).toBeNull();
    expect(host.codePrefix).toBeUndefined();
    expect(host.registrations.map((item) => [item.id, item.mixOrigin])).toEqual([
      ['r1', '高一组 · 男子单打'],
      ['r2', '高二高三组 · 男子单打'],
    ]);
    expect(hasEventMix(result)).toBe(true);
  });

  it('不同项目（男单 + 女单）：混编单打名，场次号前缀用「单打」', () => {
    const result = applyEventMixes({
      name: 'T',
      events: [
        event('host', 'MENS_SINGLES', '高一组', null, ['r1']),
        event('w1', 'WOMENS_SINGLES', '高一组', 'host', ['r2']),
      ],
    } as any);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].label).toBe('混编单打（高一组男单、高一组女单）');
    expect(result.events[0].codePrefix).toBe('单打');
  });
});
