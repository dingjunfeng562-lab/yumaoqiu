import { resetElimination } from './reset-elimination';

describe('discarding results while retaining the elimination tree', () => {
  const match = (id: string, roundNo: number, matchNo: number, side1Id: string | null, side2Id: string | null, round = 'SF') => ({ id, roundNo, matchNo, side1Id, side2Id, round });
  it('keeps first-round assignments and removes winners/losers from later rounds', () => {
    const result = resetElimination([match('a', 1, 1, 'A', 'B'), match('b', 1, 2, 'C', 'D'), match('f', 2, 1, 'A', 'C', 'F'), match('bronze', 2, 2, 'B', 'D', 'BRONZE')]);
    expect(result.map(row => [row.id, row.side1Id, row.side2Id, row.winnerSide, row.status])).toEqual([
      ['a', 'A', 'B', null, 'PENDING'], ['b', 'C', 'D', null, 'PENDING'],
      ['f', null, null, null, 'PENDING'], ['bronze', null, null, null, 'PENDING'],
    ]);
  });
  it('propagates real byes without treating an undecided opponent as a bye', () => {
    const result = resetElimination([match('a', 4, 1, 'A', null), match('b', 4, 2, 'B', 'C'), match('f', 5, 1, 'A', 'B', 'F')]);
    expect(result[0]).toMatchObject({ status: 'COMPLETED', winnerSide: 1 });
    expect(result[2]).toMatchObject({ side1Id: 'A', side2Id: null, winnerSide: null, status: 'PENDING' });
  });
  it('keeps phantom branches resolved so a real entrant is not blocked', () => {
    const result = resetElimination([match('a', 1, 1, null, null), match('b', 1, 2, 'B', null), match('f', 2, 1, null, 'B', 'F')]);
    expect(result[2]).toMatchObject({ side1Id: null, side2Id: 'B', winnerSide: 2, status: 'COMPLETED' });
  });
});
