// 「羽动云赛参赛人员批量导入模板」解析器（.xls / .xlsx 通用）。
//
// 模板结构（前端上传后由 xlsx 读成二维数组再交给这里）：
//   第 1 行  标题
//   第 2 行  使用说明
//   第 3 行  表头：序号 / 姓名 / 性别 / 联系方式（电话号码）/ 单位（学校/名字）/ 项目
//   第 4~6 行 示例（必须跳过，避免被当成真实选手）
//   第 7 行起 正式数据，序号 1~12 已预填
//
// 双打：把一对搭档的「单位」单元格上下合并，作为同一对的标识；
//       未合并的双打行会报错，避免把两个人错配成一对。
//
// 本文件不依赖 xlsx，输入是普通二维数组 + 合并区域，方便单测。

export type Gender = 'MALE' | 'FEMALE';

export type RosterCell = string | number | boolean | Date | null | undefined;
export type RosterGrid = RosterCell[][];
export type RosterMerge = { s: { r: number; c: number }; e: { r: number; c: number } };

export type RosterEventOption = {
  id: string;
  type: string;
  label: string;
  isDouble: boolean;
};

export type RosterPerson = {
  row: number;
  name: string;
  gender: Gender | null;
  contact: string;
  unit: string;
};

export type RosterEntry = {
  key: string;
  sheet: string;
  kind: 'SINGLE' | 'DOUBLE';
  eventId: string | null;
  eventLabel: string | null;
  project: string;
  unit: string;
  people: RosterPerson[];
  rows: number[];
  errors: string[];
};

export type RosterColumnMap = {
  seq: number | null;
  name: number;
  gender: number;
  contact: number;
  unit: number;
  project: number;
};

export type RosterSheetResult = {
  sheet: string;
  headerRow: number | null;
  columns: RosterColumnMap | null;
  entries: RosterEntry[];
  skipped: number;
  messages: string[];
};

export type RosterImportPlayer = {
  social: true;
  school: string;
  name: string;
  gender: Gender;
  contact: string;
  partnerName?: string;
  partnerGender?: Gender;
  partnerContact?: string;
};

const PROJECT_TYPES: Record<string, string> = {
  男子单打: 'MENS_SINGLES',
  男单: 'MENS_SINGLES',
  男字单打: 'MENS_SINGLES', // 模板说明里的错别字
  女子单打: 'WOMENS_SINGLES',
  女单: 'WOMENS_SINGLES',
  男子双打: 'MENS_DOUBLES',
  男双: 'MENS_DOUBLES',
  女子双打: 'WOMENS_DOUBLES',
  女双: 'WOMENS_DOUBLES',
  混合双打: 'MIXED_DOUBLES',
  混双: 'MIXED_DOUBLES',
  混双双打: 'MIXED_DOUBLES',
};

const TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

// 模板自带的示例行。即使使用者把「序号」一列的“示例”删掉，也按姓名 + 联系方式识别并跳过。
const TEMPLATE_EXAMPLES = [
  { name: '黄太', contact: '13995646458' },
  { name: '丽人', contact: '412945668456' },
  { name: '好人', contact: '12398745695' },
];

const HEADER_PATTERNS: Array<{ field: 'name' | 'gender' | 'contact' | 'unit' | 'project'; test: RegExp }> = [
  { field: 'name', test: /姓名|名字/ },
  { field: 'gender', test: /^性别$/ },
  { field: 'contact', test: /联系方式|联系电话|电话|手机号?/ },
  { field: 'unit', test: /^单位|学校|所属单位/ },
  { field: 'project', test: /^项目|参赛项目|组别/ },
];

export function cellText(value: RosterCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    // 11 位手机号存成数字时 String() 不会变科学计数法；这里统一去掉可能的小数尾巴。
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).replace(/\u00a0/g, ' ').trim();
}

export function normalizeProjectName(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim();
}

export function projectToEventType(value: string): string | null {
  const normalized = normalizeProjectName(value);
  if (!normalized) return null;
  return PROJECT_TYPES[normalized] ?? null;
}

export function eventTypeLabel(type: string | null): string | null {
  return type ? TYPE_LABELS[type] ?? type : null;
}

export function parseGender(value: string): Gender | null {
  const normalized = value.trim().toUpperCase();
  if (['男', 'MALE', 'M', '1'].includes(normalized)) return 'MALE';
  if (['女', 'FEMALE', 'F', '0'].includes(normalized)) return 'FEMALE';
  return null;
}

export function normalizeContact(value: string): string {
  return value.replace(/[\s\u00a0]/g, '');
}

export function applyMerges(grid: RosterGrid, merges: RosterMerge[]): RosterGrid {
  const filled: RosterGrid = grid.map((row) => [...row]);
  for (const merge of merges) {
    const topLeft = filled[merge.s.r]?.[merge.s.c];
    if (topLeft === undefined || topLeft === null) continue;
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      if (!filled[r]) continue;
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        if (filled[r][c] === undefined || filled[r][c] === null || filled[r][c] === '') {
          filled[r][c] = topLeft;
        }
      }
    }
  }
  return filled;
}

export function detectHeader(grid: RosterGrid): { row: number; columns: RosterColumnMap } | null {
  const limit = Math.min(grid.length, 30);
  for (let r = 0; r < limit; r += 1) {
    const row = grid[r] ?? [];
    const found: Partial<Record<'name' | 'gender' | 'contact' | 'unit' | 'project', number>> = {};
    let seq: number | null = null;
    row.forEach((cell, c) => {
      const text = cellText(cell).replace(/\s+/g, '');
      if (!text) return;
      if (seq === null && /^(序号|编号|no\.?)$/i.test(text)) {
        seq = c;
        return;
      }
      for (const pattern of HEADER_PATTERNS) {
        if (found[pattern.field] === undefined && pattern.test.test(text)) {
          found[pattern.field] = c;
          break;
        }
      }
    });
    if (
      found.name !== undefined &&
      found.gender !== undefined &&
      found.contact !== undefined &&
      found.unit !== undefined &&
      found.project !== undefined
    ) {
      return {
        row: r,
        columns: {
          seq,
          name: found.name,
          gender: found.gender,
          contact: found.contact,
          unit: found.unit,
          project: found.project,
        },
      };
    }
  }
  return null;
}

function mergeKeyAt(merges: RosterMerge[], r: number, c: number): string | null {
  for (const merge of merges) {
    if (merge.s.r <= r && r <= merge.e.r && merge.s.c <= c && c <= merge.e.c) {
      if (merge.s.r === merge.e.r) return null;
      return `${merge.s.r}:${merge.s.c}:${merge.e.r}:${merge.e.c}`;
    }
  }
  return null;
}

function genderErrorFor(type: string, people: RosterPerson[]): string | null {
  const [first, second] = people;
  if (type === 'MENS_SINGLES') return first.gender === 'MALE' ? null : '男子单打性别必须为男';
  if (type === 'WOMENS_SINGLES') return first.gender === 'FEMALE' ? null : '女子单打性别必须为女';
  if (!second) return null;
  if (type === 'MENS_DOUBLES') {
    return first.gender === 'MALE' && second.gender === 'MALE' ? null : '男子双打两人性别必须均为男';
  }
  if (type === 'WOMENS_DOUBLES') {
    return first.gender === 'FEMALE' && second.gender === 'FEMALE' ? null : '女子双打两人性别必须均为女';
  }
  if (type === 'MIXED_DOUBLES') {
    return first.gender && second.gender && first.gender !== second.gender ? null : '混合双打必须一男一女';
  }
  return null;
}

type RawRow = {
  index: number;
  row: number;
  person: RosterPerson;
  project: string;
  eventType: string | null;
  event: RosterEventOption | null;
  errors: string[];
  mergeKey: string | null;
};

export function parseRosterSheet(input: {
  sheet: string;
  grid: RosterGrid;
  merges: RosterMerge[];
  events: RosterEventOption[];
}): RosterSheetResult {
  const { sheet, events } = input;
  const grid = applyMerges(input.grid, input.merges);
  const detected = detectHeader(grid);
  if (!detected) {
    return {
      sheet,
      headerRow: null,
      columns: null,
      entries: [],
      skipped: 0,
      messages: ['没有找到表头：需要包含「姓名、性别、联系方式、单位、项目」五列的标题行，请使用官方模板。'],
    };
  }

  const { row: headerRow, columns } = detected;
  const entries: RosterEntry[] = [];
  const raws: RawRow[] = [];
  let skipped = 0;

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const text = (column: number | null) => (column === null ? '' : cellText(row[column]));
    const name = text(columns.name);
    const genderText = text(columns.gender);
    const contact = normalizeContact(text(columns.contact));
    const unit = text(columns.unit);
    const project = text(columns.project);
    const seq = text(columns.seq);

    if (!name && !contact && !unit && !project) {
      skipped += 1;
      continue;
    }
    if (seq.includes('示例')) {
      skipped += 1;
      continue;
    }
    if (TEMPLATE_EXAMPLES.some((item) => item.name === name && item.contact === contact)) {
      skipped += 1;
      continue;
    }

    const person: RosterPerson = {
      row: r + 1,
      name,
      gender: parseGender(genderText),
      contact,
      unit,
    };
    const errors: string[] = [];
    if (!name) errors.push('姓名不能为空');
    if (!contact) errors.push('联系方式不能为空');
    if (!unit) errors.push('单位不能为空');
    if (!person.gender) errors.push('性别需填写男或女');
    if (!project) errors.push('项目不能为空');

    const eventType = projectToEventType(project);
    if (project && !eventType) {
      errors.push(`无法识别项目「${project}」，只能填写男子单打、女子单打、男子双打、女子双打、混合双打`);
    }
    const event = eventType ? events.find((item) => item.type === eventType) ?? null : null;
    if (eventType && !event) {
      errors.push(`当前赛事未配置「${eventTypeLabel(eventType) ?? project}」项目`);
    }

    const mergeKey = mergeKeyAt(input.merges, r, columns.unit);
    if (event?.isDouble && !mergeKey) {
      errors.push('双打需把两名队员的「单位」单元格合并后再导入');
    }

    raws.push({ index: r, row: r + 1, person, project, eventType, event, errors, mergeKey });
  }

  const doubleGroups = new Map<string, RawRow[]>();
  for (const raw of raws) {
    if (raw.event?.isDouble) {
      const groupKey = raw.mergeKey
        ? `${raw.event.id}|${raw.mergeKey}`
        : `${raw.event.id}|row:${raw.index}`;
      const group = doubleGroups.get(groupKey) ?? [];
      group.push(raw);
      doubleGroups.set(groupKey, group);
      continue;
    }

    // 单打，或项目无法识别：一行一条，直接展示问题。
    const errors = [...raw.errors];
    if (raw.eventType && raw.event && !raw.event.isDouble) {
      const genderError = genderErrorFor(raw.event.type, [raw.person]);
      if (genderError) errors.push(genderError);
    }
    entries.push({
      key: `${sheet}-${raw.row}`,
      sheet,
      kind: 'SINGLE',
      eventId: raw.event?.id ?? null,
      eventLabel: raw.event?.label ?? eventTypeLabel(raw.eventType),
      project: raw.project,
      unit: raw.person.unit,
      people: [raw.person],
      rows: [raw.row],
      errors: unique(errors),
    });
  }

  for (const group of doubleGroups.values()) {
    const people = group.map((raw) => raw.person);
    const errors = unique(group.flatMap((raw) => raw.errors));
    if (people.length === 2) {
      // 正常的一对
    } else if (people.length > 2) {
      errors.push(`这一组有 ${people.length} 人，双打每对只能 2 人`);
    } else if (group.some((raw) => raw.mergeKey)) {
      errors.push('合并的「单位」范围内只找到 1 名队员，双打每对需要 2 人');
    }
    if (group[0]?.event) {
      const genderError = genderErrorFor(group[0].event.type, people);
      if (genderError) errors.push(genderError);
    }
    entries.push({
      key: `${sheet}-${group.map((raw) => raw.row).join('-')}`,
      sheet,
      kind: 'DOUBLE',
      eventId: group[0]?.event?.id ?? null,
      eventLabel: group[0]?.event?.label ?? eventTypeLabel(group[0]?.eventType ?? null),
      project: group[0]?.project ?? '',
      unit: group[0]?.person.unit ?? '',
      people,
      rows: group.map((raw) => raw.row),
      errors,
    });
  }

  markDuplicates(entries);
  entries.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0));

  return {
    sheet,
    headerRow: headerRow + 1,
    columns,
    entries,
    skipped,
    messages: [],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function markDuplicates(entries: RosterEntry[]) {
  const seen = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.eventId) continue;
    for (const person of entry.people) {
      if (!person.name || !person.contact) continue;
      const key = `${entry.eventId}\u0000${person.name}\u0000${person.contact}`;
      const firstRow = seen.get(key);
      if (firstRow === undefined) {
        seen.set(key, person.row);
        continue;
      }
      if (firstRow !== person.row) {
        entry.errors.push(`与第 ${firstRow} 行重复：${person.name}（${person.contact}）`);
      }
    }
  }
}

export function rosterImportGroups(entries: RosterEntry[]): Array<{ eventId: string; players: RosterImportPlayer[] }> {
  const groups = new Map<string, RosterImportPlayer[]>();
  for (const entry of entries) {
    if (entry.errors.length || !entry.eventId) continue;
    const [first, second] = entry.people;
    if (!first?.gender) continue;
    if (entry.kind === 'DOUBLE' && !second?.gender) continue;
    const player: RosterImportPlayer = {
      social: true,
      school: entry.unit || first.unit,
      name: first.name,
      gender: first.gender,
      contact: first.contact,
      ...(entry.kind === 'DOUBLE' && second
        ? { partnerName: second.name, partnerGender: second.gender as Gender, partnerContact: second.contact }
        : {}),
    };
    const group = groups.get(entry.eventId) ?? [];
    group.push(player);
    groups.set(entry.eventId, group);
  }
  return [...groups].map(([eventId, players]) => ({ eventId, players }));
}

export function rosterPeopleCount(entries: RosterEntry[]): number {
  return entries.reduce((total, entry) => total + entry.people.length, 0);
}
