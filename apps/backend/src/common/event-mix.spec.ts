import { hostDisplayLabel, mergeMixRegistrations, mixCategory, mixLabel } from './event-mix';
import { tournamentResultsReady } from './tournament-results-ready';

describe('混编（event-mix）', () => {
  it('单打类：男单、女单；双打类：男双、女双、混双', () => {
    expect(mixCategory('MENS_SINGLES')).toBe('SINGLES');
    expect(mixCategory('WOMENS_SINGLES')).toBe('SINGLES');
    expect(mixCategory('MENS_DOUBLES')).toBe('DOUBLES');
    expect(mixCategory('WOMENS_DOUBLES')).toBe('DOUBLES');
    expect(mixCategory('MIXED_DOUBLES')).toBe('DOUBLES');
  });

  it('同一种项目混编：混编（主项目组别+其他组别） · 项目，主项目在前', () => {
    expect(mixLabel([
      { type: 'MENS_SINGLES', groupLabel: '高一组' },
      { type: 'MENS_SINGLES', groupLabel: '高二高三组' },
    ])).toBe('混编（高一组+高二高三组） · 男子单打');
    expect(mixLabel([
      { type: 'MENS_SINGLES', groupLabel: '高二高三组' },
      { type: 'MENS_SINGLES', groupLabel: '高一组' },
    ])).toBe('混编（高二高三组+高一组） · 男子单打');
  });

  it('不同项目混编：混编单打（主项目、并入项目按男单女单…排）', () => {
    expect(mixLabel([
      { type: 'MENS_SINGLES', groupLabel: '高一组' },
      { type: 'WOMENS_SINGLES', groupLabel: '高二组' },
      { type: 'MENS_SINGLES', groupLabel: '高二组' },
    ])).toBe('混编单打（高一组男单、高二组男单、高二组女单）');
    expect(mixLabel([
      { type: 'MIXED_DOUBLES', groupLabel: '教工组' },
      { type: 'MENS_DOUBLES', groupLabel: '教工组' },
    ])).toBe('混编双打（教工组混双、教工组男双）');
  });

  it('并入项目的先后顺序不影响名称（各处查询顺序不同也一致）', () => {
    const host = { type: 'MENS_SINGLES', groupLabel: '高一组' };
    const a = { type: 'WOMENS_SINGLES', groupLabel: '高一组' };
    const b = { type: 'MENS_SINGLES', groupLabel: '高二组' };
    expect(mixLabel([host, a, b])).toBe(mixLabel([host, b, a]));
  });

  it('没有并入项目时就是普通的「组别 · 项目」', () => {
    expect(hostDisplayLabel({ type: 'MENS_SINGLES', groupLabel: '高一组', mixMembers: [] })).toBe('高一组 · 男子单打');
  });

  it('合并名单：主项目和并入项目的报名都在，并标上原项目；普通单项原样返回', () => {
    const plain = { type: 'MENS_SINGLES', groupLabel: '高一组', registrations: [{ id: 'a' }], mixMembers: [] };
    expect(mergeMixRegistrations(plain)).toBe(plain);

    const merged = mergeMixRegistrations({
      type: 'MENS_SINGLES',
      groupLabel: '高一组',
      registrations: [{ id: 'a' }],
      mixMembers: [{ type: 'WOMENS_SINGLES', groupLabel: '高一组', registrations: [{ id: 'b' }, { id: 'c' }] }],
    });
    expect(merged.registrations).toEqual([
      { id: 'a', mixOrigin: '高一组 · 男子单打' },
      { id: 'b', mixOrigin: '高一组 · 女子单打' },
      { id: 'c', mixOrigin: '高一组 · 女子单打' },
    ]);
  });

  it('成绩是否可公布：并入混编的单项（有报名、没场次）不算未完赛', () => {
    const finalDone = {
      format: 'SINGLE_ELIMINATION',
      registrations: [{ id: 'a' }, { id: 'b' }],
      matches: [{ status: 'COMPLETED', round: 'F', roundNo: 1, side1Id: 'a', side2Id: 'b', winnerSide: 1 }],
    };
    const member = { format: 'SINGLE_ELIMINATION', mixHostId: 'host', registrations: [{ id: 'c' }], matches: [] };
    expect(tournamentResultsReady({ status: 'ONGOING', events: [finalDone, member], teamCompetitions: [] })).toBe(true);
    expect(tournamentResultsReady({ status: 'ONGOING', events: [finalDone, { ...member, mixHostId: null }], teamCompetitions: [] })).toBe(false);
  });
});
