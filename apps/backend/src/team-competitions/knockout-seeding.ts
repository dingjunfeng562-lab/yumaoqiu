/**
 * 小组赛后淘汰赛的签位编排。
 *
 * 1. 各组第一按标准种子位排位，种子靠前的优先轮空（与原规则一致）。
 *    同名次队伍之间的种子先后由调用方给出（小组赛场均战绩），不给时按组号。
 * 2. 其余名次（各组第二、第三……）在同名次队伍之间调换签位，让同组队伍尽量晚相遇：
 *    先尽量避免首轮相遇，其次避免第二轮相遇，以此类推；能做到时同组队伍分在两个半区。
 *
 * 原来的写法直接套标准种子位，3 组各出线 2 队时 C1 与 C2 首轮相遇，
 * 4 组各出线 2 队时每组第一、第二都在同一半区，半决赛前就可能再次相遇。
 */

/** 标准种子位：size=4 → [1,4,2,3]，size=8 → [1,8,4,5,2,7,3,6]；数组下标为签位，值为种子号。 */
export function seedPositions(size: number) {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap(seed => [seed, total - seed]);
  }
  return order;
}

export function nextPowerOfTwo(value: number) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

/** 两个签位的队伍都一路获胜时在第几轮相遇：1 为首轮，log2(签表大小) 为决赛。 */
export function meetingRound(a: number, b: number) {
  return Math.floor(Math.log2(a ^ b)) + 1;
}

type Entry = { id: string; group: number; tier: number };

/**
 * @param qualifiers 按组号排列，每组按小组名次列出出线队伍：qualifiers[组][名次-1] = 队伍 ID
 * @param compare 同名次队伍之间谁的种子更高（返回负数表示 a 在前）；相同或不传时按组号先后
 * @returns 按签位顺序排列的队伍 ID，null 为轮空
 */
export function seedGroupQualifiers(
  qualifiers: string[][],
  compare?: (a: string, b: string) => number,
): Array<string | null> {
  const entries: Entry[] = [];
  const depth = Math.max(0, ...qualifiers.map(teams => teams.length));
  for (let tier = 0; tier < depth; tier++) {
    const tierEntries: Entry[] = [];
    qualifiers.forEach((teams, group) => {
      if (teams[tier]) tierEntries.push({ id: teams[tier], group, tier });
    });
    if (compare) tierEntries.sort((a, b) => compare(a.id, b.id));
    entries.push(...tierEntries);
  }
  if (!entries.length) return [];
  const size = nextPowerOfTwo(entries.length);
  const slots: Array<Entry | null> = seedPositions(size).map(seed => entries[seed - 1] ?? null);
  const rounds = Math.max(1, Math.log2(size));

  // 代价：每一轮里同组相遇的对数，越早的轮次越重要，按轮次从前往后逐项比较。
  const cost = () => {
    const counts = new Array<number>(rounds).fill(0);
    for (let i = 0; i < size; i++) {
      const a = slots[i];
      if (!a) continue;
      for (let j = i + 1; j < size; j++) {
        const b = slots[j];
        if (b && b.group === a.group) counts[meetingRound(i, j) - 1]++;
      }
    }
    return counts;
  };
  const better = (next: number[], current: number[]) => {
    for (let round = 0; round < rounds; round++) {
      if (next[round] !== current[round]) return next[round] < current[round];
    }
    return false;
  };

  // 小组第一不动；其余名次只在同名次之间两两调换，直到再也降不下代价。
  let best = cost();
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        const a = slots[i], b = slots[j];
        if (!a || !b || a.tier === 0 || a.tier !== b.tier || a.group === b.group) continue;
        slots[i] = b; slots[j] = a;
        const next = cost();
        if (better(next, best)) {
          best = next;
          improved = true;
        } else {
          slots[i] = a; slots[j] = b;
        }
      }
    }
  }
  return slots.map(slot => slot?.id ?? null);
}
