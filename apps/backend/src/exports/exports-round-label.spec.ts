import { exportRoundLabel } from './exports.service';

const match = (round: string, roundNo: number) => ({ round, roundNo, roundText: undefined }) as never;

describe('exportRoundLabel 导出轮次列', () => {
  it('淘汰赛代码翻成中文阶段名', () => {
    expect(exportRoundLabel(match('R1', 1))).toBe('1/8决赛');
    expect(exportRoundLabel(match('QF', 2))).toBe('1/4决赛');
    expect(exportRoundLabel(match('SF', 3))).toBe('半决赛');
    expect(exportRoundLabel(match('BRONZE', 4))).toBe('季军赛');
    expect(exportRoundLabel(match('F', 4))).toBe('决赛');
    expect(exportRoundLabel(match('R2', 2))).toBe('1/16决赛');
  });

  it('排位赛 P5 这类翻成名次赛', () => {
    expect(exportRoundLabel(match('P5', 5))).toBe('5-6名决赛');
    expect(exportRoundLabel(match('P1', 9))).toBe('1-2名决赛');
  });

  it('小组循环和第二阶段保持原样', () => {
    expect(exportRoundLabel(match('A', 0))).toBe('A');
    expect(exportRoundLabel(match('决赛', 101))).toBe('决赛');
    expect(exportRoundLabel(match('', 0))).toBe('小组循环');
  });

  it('已有 roundText 时优先用它（团体赛映射过来的场次）', () => {
    expect(exportRoundLabel({ round: 'F', roundNo: 4, roundText: '1-2名决赛' } as never)).toBe('1-2名决赛');
  });
});
