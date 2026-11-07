import { meetingRound, seedGroupQualifiers, seedPositions } from './knockout-seeding';

/** groups 组、每组出线 advance 队：A1、A2、B1…… */
function qualifiers(groups: number, advance: number) {
  return Array.from({ length: groups }, (_, group) =>
    Array.from({ length: advance }, (_, rank) => `${String.fromCharCode(65 + group)}${rank + 1}`));
}

/** 同组两队一路获胜时最早在第几轮相遇。 */
function sameGroupMeetings(slots: Array<string | null>) {
  const rounds: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      if (slots[i] && slots[j] && slots[i]![0] === slots[j]![0]) rounds.push(meetingRound(i, j));
    }
  }
  return rounds;
}

describe('knockout seeding after group stage', () => {
  it('keeps the standard seed order', () => {
    expect(seedPositions(4)).toEqual([1, 4, 2, 3]);
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it.each([[2, 2], [3, 2], [4, 2], [6, 2], [8, 2]])(
    '%i groups x %i qualifiers: teams from the same group can only meet in the final',
    (groups, advance) => {
      const slots = seedGroupQualifiers(qualifiers(groups, advance));
      const finalRound = Math.log2(slots.length);
      expect(sameGroupMeetings(slots).every(round => round === finalRound)).toBe(true);
    },
  );

  it('no longer pairs C1 with C2 in the first round for 3 groups x 2', () => {
    const slots = seedGroupQualifiers(qualifiers(3, 2));
    const firstRound = [];
    for (let i = 0; i < slots.length; i += 2) firstRound.push([slots[i], slots[i + 1]]);
    expect(firstRound).not.toContainEqual(['C1', 'C2']);
    expect(firstRound).not.toContainEqual(['C2', 'C1']);
  });

  it('still gives byes to group winners first', () => {
    const slots = seedGroupQualifiers(qualifiers(3, 2));
    const byes = slots.filter((team, index) => team && !slots[index ^ 1]);
    expect(byes).toEqual(['A1', 'B1']);
  });

  it('never meets in the first round when it can be avoided, even with three per group', () => {
    expect(sameGroupMeetings(seedGroupQualifiers(qualifiers(4, 3)))).not.toContain(1);
    expect(sameGroupMeetings(seedGroupQualifiers(qualifiers(3, 3)))).not.toContain(1);
  });

  it('seeds same-place teams by the given record, so the best group winners get the byes', () => {
    const order = ['C1', 'A1', 'B1'];
    const byRecord = (a: string, b: string) => {
      const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
      return rank(a) - rank(b);
    };
    const slots = seedGroupQualifiers(qualifiers(3, 2), byRecord);
    expect(slots[0]).toBe('C1');
    const byes = slots.filter((team, index) => team && !slots[index ^ 1]);
    expect(byes.sort()).toEqual(['A1', 'C1']);
    expect(sameGroupMeetings(slots).every(round => round === 3)).toBe(true);
  });

  it('places every qualifier exactly once', () => {
    const slots = seedGroupQualifiers(qualifiers(5, 2));
    expect(slots).toHaveLength(16);
    expect(slots.filter(Boolean).sort()).toEqual(qualifiers(5, 2).flat().sort());
  });
});
