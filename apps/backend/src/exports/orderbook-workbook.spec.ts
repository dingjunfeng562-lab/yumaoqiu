import * as ExcelJS from 'exceljs';
import { buildOrderbookWorkbook } from './orderbook-workbook';
import type { ExportTournament } from './exports.service';

function fixture(): ExportTournament {
  return { name: '循环排名导出测试', startDate: new Date('2026-10-22'), endDate: new Date('2026-10-23'), events: [],
    teamCompetitions: [{ name: '团体循环', format: 'ROUND_ROBIN', teams: ['甲', '乙', '丙'].map(id => ({ id, name: id, affiliation: '', finalRank: null })),
      groups: [{ id: 'g', groupNo: 1, groupName: 'A组', teams: ['甲', '乙', '丙'].map(teamId => ({ teamId })) }],
      teamMatches: [['甲', '乙'], ['乙', '丙'], ['丙', '甲']].map(([team1Id, team2Id], index) => ({
        id: String(index), round: 'A', roundNo: index + 1, matchNo: index + 1, stage: 'GROUP', groupId: 'g',
        status: 'COMPLETED', team1Id, team2Id, winnerTeamId: team1Id, team1Wins: 2, team2Wins: 1, matches: [],
      })),
    }],
  };
}

async function rankingRows(tournament: ExportTournament) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildOrderbookWorkbook(tournament) as never);
  return workbook.getWorksheet('名次汇总')!.getRows(3, 3)!.map(row => [2, 3, 4, 5].map(col => row.getCell(col).text));
}

describe('team orderbook final rankings', () => {
  it('retains the second-stage template area without adding knockout matches', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildOrderbookWorkbook(fixture()) as never);
    const texts: string[] = [];
    workbook.getWorksheet('流程表')!.eachRow(row => row.eachCell(cell => texts.push(cell.text)));
    expect(texts).toContain('团体循环第二阶段：');
    expect(texts).toContain('单组循环全部结束后确定各队名次，见“名次汇总”。');
    expect(workbook.getWorksheet('淘汰赛')!.getCell('A3').text).toBe('暂无淘汰赛场次');
  });
  it('exports every team when three teams share a final rank', async () => {
    const rows = await rankingRows(fixture());
    expect(rows.map(row => row[0])).toEqual(['第1名', '第1名', '第1名']);
    expect(new Set(rows.map(row => row[1]))).toEqual(new Set(['甲', '乙', '丙']));
    expect(rows.every(row => row[2] === '团体赛最终排名' && row[3] === '已确定')).toBe(true);
  });
  it('marks incomplete competitions as provisional', async () => {
    const tournament = fixture();
    tournament.teamCompetitions![0].teamMatches[2].status = 'LIVE';
    const rows = await rankingRows(tournament);
    expect(rows.every(row => row[0].startsWith('暂列') && row[3] === '待定')).toBe(true);
  });
  it('keeps manually unassigned places pending, even after completion', async () => {
    const tournament = fixture();
    tournament.teamCompetitions![0].teams[0].finalRank = 1;
    const rows = await rankingRows(tournament);
    expect(rows[0]).toEqual(['第1名', '甲', '手动设置', '已确定']);
    expect(rows.slice(1).every(row => row[0] === '未设置' && row[3] === '待定')).toBe(true);
  });
});
