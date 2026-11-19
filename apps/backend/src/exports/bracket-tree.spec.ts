import * as ExcelJS from 'exceljs';
import { buildKnockoutSkeleton } from '../common/knockout-skeleton';
import { renderBracketSvg } from './bracket-svg';
import { buildOrderbookWorkbook, eventBracketTreeForImage } from './orderbook-workbook';
import type { ExportEvent, ExportMatch, ExportRegistration, ExportTournament } from './exports.service';

const day = new Date('2026-11-28T00:00:00Z');

function reg(id: string, name: string, affiliation = '某大学'): ExportRegistration {
  return {
    id, eventId: 'e1', studentId: null, createdAt: day, className: null, groupName: null, teamName: null,
    isSeed: false, seedRank: null, player1: { name, gender: 'MALE', affiliation, contact: null }, player2: null,
    competitionRegistration: null,
  };
}

function match(partial: Partial<ExportMatch> & Pick<ExportMatch, 'id' | 'round' | 'roundNo' | 'matchNo'>): ExportMatch {
  return {
    venueId: null, scheduledAt: null, status: 'PENDING', durationMinutes: 30, side1Id: null, side2Id: null,
    winnerSide: null, updatedAt: day, venue: null, referee: null, games: [], ...partial,
  };
}

const GROUPS = 'ABCDEFGHIJKL'.split('');

// 36 人 12 组，每组 3 人：小组赛场次（roundNo 0，round = 组别）。
function groupStage() {
  const registrations: ExportRegistration[] = [];
  const matches: ExportMatch[] = [];
  GROUPS.forEach((group, g) => {
    const ids = [0, 1, 2].map((k) => {
      const id = `p${g * 3 + k + 1}`;
      registrations.push(reg(id, `选手${g * 3 + k + 1}`));
      return id;
    });
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      matches.push(match({ id: `g${matches.length + 1}`, round: group, roundNo: 0, matchNo: matches.length + 1, side1Id: ids[a], side2Id: ids[b] }));
    }
  });
  return { registrations, matches };
}

// 小组赛结束后生成的 32 签淘汰赛：首轮 8 场轮空已结束，其余未开始（后面几轮双方都是「待定」）。
function generatedKnockout() {
  const skeleton = buildKnockoutSkeleton(GROUPS, 2, new Map(GROUPS.map((g) => [g, 3])))!;
  const registrations = skeleton.participants.filter((p) => !p.isBye).map((p) => reg(p.id, p.name.replace(/组第(\d)名/, '$1'), `${p.name[0]}大学`));
  const matches = skeleton.matches.map((m) => match({
    id: m.id, round: m.round, roundNo: m.roundNo, matchNo: m.matchNo, status: m.status,
    side1Id: m.side1Id, side2Id: m.side2Id, winnerSide: m.winnerSide,
  }));
  return { registrations, matches };
}

function stdEvent(partial: Partial<ExportEvent>): ExportEvent {
  return { type: 'MENS_SINGLES', format: 'GROUP_PLUS_KNOCKOUT_STD', qualifiersPerGroup: 2, registrations: [], matches: [], secondStage: null, ...partial };
}

function tournament(events: ExportEvent[]): ExportTournament {
  return { name: '对阵树测试', startDate: day, endDate: day, events };
}

async function flowTexts(t: ExportTournament, stage?: 'first' | 'second') {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildOrderbookWorkbook(t, stage ? { stage } : undefined) as never);
  const texts: string[] = [];
  // 合并单元格只取主格，避免同一个名字被数多次。
  workbook.getWorksheet('流程表')!.eachRow((row) => row.eachCell((cell) => {
    if (cell.master.address === cell.address && cell.text) texts.push(cell.text);
  }));
  return texts;
}

const count = (texts: string[], value: string) => texts.filter((text) => text === value).length;

describe('第二阶段淘汰对阵树', () => {
  it('淘汰赛生成后，后面几轮双方都「待定」的场次逐场保留，不再缩成一个框', async () => {
    const group = groupStage();
    const knockout = generatedKnockout();
    const event = stdEvent({ registrations: [...group.registrations, ...knockout.registrations], matches: [...group.matches, ...knockout.matches] });

    const result = eventBracketTreeForImage(event);
    if (!('tree' in result)) throw new Error(result.reason);
    const { tree } = result;
    expect(tree.rounds.map((round) => [round.label, round.matches.length])).toEqual([
      ['1/16决赛', 16], ['1/8决赛', 8], ['1/4决赛', 4], ['半决赛', 2], ['决赛', 1],
    ]);
    expect(tree.drawSize).toBe(32);
    expect(tree.preview).toBe(false);
    expect(tree.champion).toBe('');
    expect(tree.bronze).not.toBeNull();
    // 轮空：8 场首轮只有一方，空的一方写「轮空」。
    const byeSides = tree.rounds[0].matches.flatMap((m) => m.sides).filter((side) => side.bye);
    expect(byeSides).toHaveLength(8);
    expect(byeSides.every((side) => side.name === '轮空')).toBe(true);

    const texts = await flowTexts(tournament([event]));
    expect(texts).toContain('男子单打第二阶段：');
    for (const label of ['1/16决赛', '1/8决赛', '1/4决赛', '半决赛', '决赛', '冠军']) expect(count(texts, label)).toBe(1);
    expect(count(texts, '轮空')).toBe(8);
    // 1/8 决赛 8 个待定 + 1/4 决赛 8 + 半决赛 4 + 决赛 2 + 季军赛 2 + 冠军 1。
    expect(count(texts, '待定')).toBe(25);
    expect(texts).toContain('季军赛');
  });

  it('按阶段导出第二阶段：小组赛结束前也按各组人数画出「X组第N名」骨架', async () => {
    const group = groupStage();
    const sizes = Object.fromEntries(GROUPS.map((g) => [g, 3]));
    const texts = await flowTexts(tournament([stdEvent({ registrations: group.registrations, matches: [], groupSizes: sizes })]), 'second');
    expect(texts).toContain('男子单打第二阶段：');
    for (const g of GROUPS) {
      expect(texts).toContain(`${g}组第1名`);
      expect(texts).toContain(`${g}组第2名`);
    }
    expect(count(texts, '轮空')).toBe(8);
    expect(texts).toContain('冠军');

    const preview = eventBracketTreeForImage(stdEvent({ matches: group.matches }));
    expect('tree' in preview && preview.tree.preview).toBe(true);
  });

  it('超过 32 签按每 32 个签位分段画，最后单独画决赛阶段', async () => {
    const codes = Array.from({ length: 38 }, (_, i) => `G${i + 1}`);
    const matches = codes.flatMap((code, g) => [[0, 1], [0, 2], [1, 2]].map(([a, b], k) => match({
      id: `g${g}-${k}`, round: code, roundNo: 0, matchNo: g * 3 + k + 1, side1Id: `${code}-${a}`, side2Id: `${code}-${b}`,
    })));
    const result = eventBracketTreeForImage(stdEvent({ matches }));
    expect('tree' in result && result.tree.drawSize).toBe(128);
    expect('tree' in result && result.tree.rounds[0].label).toBe('1/64决赛');

    const texts = await flowTexts(tournament([stdEvent({ matches })]));
    for (const range of ['1–32', '33–64', '65–96', '97–128']) expect(texts).toContain(`男子单打第二阶段（第${range}号签位）：`);
    expect(texts).toContain('男子单打第二阶段（决赛阶段）：');
    expect(count(texts, '1/64决赛')).toBe(4);
    expect(count(texts, '冠军')).toBe(1);
    expect(count(texts, '轮空')).toBe(52);
  });

  it('团体赛同一场的多个子项只画一个框，不同场次（含双方待定）各自保留', async () => {
    const children = (prefix: string) => [1, 2, 3].map((i) => ({
      id: `${prefix}-${i}`, status: 'PENDING', winnerSide: null, scheduledAt: null, lineupLocked: false,
      teamCompetitionItemId: null, teamCompetitionItem: null, venue: null,
    }));
    const encounter = (id: string, round: string, roundNo: number, matchNo: number, team1Id: string | null, team2Id: string | null) => ({
      id, round, roundNo, matchNo, stage: 'KNOCKOUT', status: 'PENDING', team1Id, team2Id, winnerTeamId: null,
      team1Wins: 0, team2Wins: 0, matches: children(id),
    });
    const t: ExportTournament = {
      ...tournament([]),
      teamCompetitions: [{
        name: '团体淘汰', format: 'SINGLE_ELIMINATION', teams: ['甲', '乙', '丙', '丁'].map((id) => ({ id, name: id, affiliation: '' })),
        teamMatches: [
          encounter('sf1', 'SF', 1, 1, '甲', '乙'),
          encounter('sf2', 'SF', 1, 2, '丙', '丁'),
          encounter('f', 'F', 2, 3, null, null),
        ],
      }],
    };
    const texts = await flowTexts(t);
    for (const team of ['甲', '乙', '丙', '丁']) expect(count(texts, team)).toBe(1);
    expect(count(texts, '待定')).toBe(3); // 决赛双方 + 冠军
  });

  it('循环赛、排位赛、还没抽签的项目给出画不了的原因', () => {
    expect(eventBracketTreeForImage(stdEvent({ format: 'ROUND_ROBIN' }))).toEqual({ reason: '循环赛没有淘汰对阵图' });
    const playoff = stdEvent({ format: 'GROUP_PLUS_PLAYOFF', matches: [match({ id: 'p', round: 'P5', roundNo: 1, matchNo: 1 })] });
    expect('reason' in eventBracketTreeForImage(playoff)).toBe(true);
    expect('reason' in eventBracketTreeForImage(stdEvent({ format: 'SINGLE_ELIMINATION' }))).toBe(true);
  });

  it('对阵图 SVG：名字、单位、比分、轮空、冠军都画上，特殊字符转义', () => {
    const final = match({
      id: 'f', round: 'F', roundNo: 2, matchNo: 3, status: 'COMPLETED', side1Id: 'a', side2Id: 'c', winnerSide: 1,
      games: [{ gameNo: 1, side1Score: 21, side2Score: 15 }, { gameNo: 2, side1Score: 21, side2Score: 19 }],
      scheduledAt: new Date('2026-11-28T07:30:00Z'), venueId: 'v1', venue: { name: '1号场', sortOrder: 1 },
    });
    const event = stdEvent({
      format: 'SINGLE_ELIMINATION',
      registrations: [reg('a', '张<三>', '甲大学'), reg('b', '李四', '乙大学'), reg('c', '王五', '丙大学')],
      matches: [
        match({ id: 's1', round: 'SF', roundNo: 1, matchNo: 1, status: 'COMPLETED', side1Id: 'a', side2Id: 'b', winnerSide: 1, games: [{ gameNo: 1, side1Score: 21, side2Score: 10 }] }),
        match({ id: 's2', round: 'SF', roundNo: 1, matchNo: 2, status: 'COMPLETED', side1Id: 'c', side2Id: null, winnerSide: 1 }),
        final,
      ],
    });
    const result = eventBracketTreeForImage(event);
    if (!('tree' in result)) throw new Error(result.reason);
    expect(result.tree.champion).toBe('张<三>');
    expect(result.tree.rounds[1].matches[0].info).toBe('男单1  11-28 15:30  1号场');
    const { svg, width, height } = renderBracketSvg(result.tree, { title: '测试赛 · 男子单打 对阵图', subtitle: '4 签' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(width).toBeGreaterThan(600);
    expect(height).toBeGreaterThan(200);
    expect(svg).toContain('张&#60;三&#62;');
    expect(svg).not.toContain('张<三>');
    for (const textValue of ['李四', '甲大学', '轮空', '冠军', '半决赛', '决赛', '21  21', '15  19', '男单1  11-28 15:30  1号场']) {
      expect(svg).toContain(`>${textValue}<`);
    }
  });
});
