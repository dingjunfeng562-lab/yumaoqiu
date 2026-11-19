import { compareGroupCode } from './knockout-skeleton';
import { groupCodeFor, groupCodeSortValue, isNumericGroupCode } from './group-code';

describe('小组编号 groupCodeFor / groupCodeSortValue', () => {
  it('字母：0→A、25→Z、26→AA、51→AZ、52→BA、99→CV；数字：0→1、99→100', () => {
    expect([0, 25, 26, 51, 52, 99].map((i) => groupCodeFor(i))).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'CV']);
    expect([0, 1, 9, 99].map((i) => groupCodeFor(i, 'NUMBER'))).toEqual(['1', '2', '10', '100']);
  });

  it('排序值：字母 A=1、Z=26、AA=27；数字按数值，带「组」也认', () => {
    expect(['A', 'Z', 'AA', 'CV'].map(groupCodeSortValue)).toEqual([1, 26, 27, 100]);
    expect(['1', '2', '10', '100', '3组', 'a'].map(groupCodeSortValue)).toEqual([1, 2, 10, 100, 3, 1]);
    expect(groupCodeSortValue('循环赛')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('按排序值排：数字 2 在 10 前，字母 B 在 AA 前（数据库按字符串排会弄反）', () => {
    const sort = (codes: string[]) => [...codes].sort((a, b) => groupCodeSortValue(a) - groupCodeSortValue(b));
    expect(sort(['10', '2', '1', '11', '3'])).toEqual(['1', '2', '3', '10', '11']);
    expect(sort(['AA', 'B', 'A', 'Z'])).toEqual(['A', 'B', 'Z', 'AA']);
    // 对阵骨架用的 compareGroupCode（先比长度）对数字编号同样成立
    expect(['10', '2', '1', '100', '9'].sort(compareGroupCode)).toEqual(['1', '2', '9', '10', '100']);
  });

  it('数字编号判断', () => {
    expect(isNumericGroupCode('1')).toBe(true);
    expect(isNumericGroupCode(' 12 ')).toBe(true);
    expect(isNumericGroupCode('A')).toBe(false);
    expect(isNumericGroupCode('1组')).toBe(false);
    expect(isNumericGroupCode(null)).toBe(false);
  });
});
