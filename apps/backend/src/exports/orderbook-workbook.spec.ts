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
  it.each(['LIVE', 'COMPLETED'])('exports the official 3:0 and +45 points while the encounter is %s', async (status) => {
    const tournament = fixture();
    const competition = tournament.teamCompetitions![0];
    competition.winThreshold = 3;
    competition.teams = ['甲队', '乙队'].map(id => ({ id, name: id, affiliation: '', finalRank: null }));
    competition.groups![0].teams = competition.teams.map(team => ({ teamId: team.id }));
    competition.teamMatches = [{ ...competition.teamMatches[0], status, team1Id: '甲队', team2Id: '乙队', winnerTeamId: '甲队',
      team1Wins: 3, team2Wins: 2,
      matches: [1, 1, 1, 2, 2].map((side, index) => ({
        id: `child${index}`, matchNo: index + 1, status: status === 'LIVE' && index > 2 ? 'PENDING' : 'COMPLETED',
        winnerSide: status === 'LIVE' && index > 2 ? null : side,
        scheduledAt: null, lineupLocked: true, teamCompetitionItemId: null, teamCompetitionItem: null, venue: null,
        games: [{ gameNo: 1, side1Score: side === 1 ? 15 : 0, side2Score: side === 2 ? 15 : 0 }],
      })),
    }];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildOrderbookWorkbook(tournament) as never);
    const sheet = workbook.getWorksheet('分组表')!;
    let winnerRow: ExcelJS.Row | undefined;
    sheet.eachRow(row => { if (row.getCell(2).text === '甲队') winnerRow = row; });
    expect(winnerRow).toBeDefined();
    expect([6, 7, 8, 9, 10].map(col => winnerRow!.getCell(col).text)).toEqual(['3:0', '1', '3', '45', '1']);
    expect(workbook.getWorksheet('名次汇总')!.getCell('B3').text).toBe(status === 'LIVE' ? '暂列第1名' : '第1名');
  });

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

describe('超过 26 组的组别顺序', () => {
  it('流程表小组按 A…Z、AA、AB 排列，AA 不会插到 A 和 B 之间', async () => {
    const codes = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), 'AA', 'AB'];
    const day = new Date('2026-11-28T00:00:00Z');
    const registrations = codes.flatMap((code) => [1, 2].map((k) => ({
      id: `${code}${k}`, eventId: 'e', studentId: null, createdAt: day, className: null, groupName: code, teamName: null,
      isSeed: false, seedRank: null, player1: { name: `${code}组${k}号`, gender: 'MALE', affiliation: '', contact: null },
      player2: null, competitionRegistration: null,
    })));
    const matches = codes.map((code, index) => ({
      id: `m${index}`, round: code, roundNo: 0, matchNo: index + 1, venueId: null, scheduledAt: null, status: 'PENDING',
      durationMinutes: 30, side1Id: `${code}1`, side2Id: `${code}2`, winnerSide: null, updatedAt: day, venue: null,
      referee: null, games: [],
    }));
    const tournament: ExportTournament = {
      name: '多组测试', startDate: day, endDate: day,
      events: [{ type: 'MENS_SINGLES', format: 'GROUP_PLUS_KNOCKOUT_STD', qualifiersPerGroup: 1, registrations, matches, secondStage: null }],
    };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildOrderbookWorkbook(tournament) as never);
    const titles: string[] = [];
    workbook.getWorksheet('流程表')!.eachRow((row) => row.eachCell((cell) => {
      if (cell.master.address === cell.address && /^[A-Z]{1,2}组$/.test(cell.text)) titles.push(cell.text);
    }));
    expect(titles).toEqual(codes.map((code) => `${code}组`));
  });
});
