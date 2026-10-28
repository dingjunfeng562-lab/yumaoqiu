// 「羽动云赛参赛人员批量导入」解析器（.xls / .xlsx 通用）。
//
// 支持两个官方模板：
//   学生模板 9 列：序号 / 姓名 / 性别 / 学号 / 学院 / 年级专业 / 联系方式 / 单位 / 项目
//   社会模板 6 列：序号 / 姓名 / 性别 / 联系方式 / 单位 / 项目
//
// 识别原则：按表头指纹识别，不依赖文件名。
//   - 基础 5 列：姓名、性别、联系方式、单位、项目；
//   - 出现 学号/学院/年级专业 → 学生组；都没有 → 社会组；
//   - 有学生字段但缺学号 → 报错；
//   - 学生字段是否必填由赛事 registrationFieldRules 决定。
//
// 本文件不依赖 xlsx，输入是普通二维数组 + 合并区域，方便单测。

export type Gender = 'MALE' | 'FEMALE';
export type EntrantType = 'SCHOOL' | 'SOCIAL';
export type RosterTemplateKind = EntrantType;
export type FieldState = 'required' | 'optional' | 'hidden';

export type RosterFieldRules = {
  SCHOOL: { studentId: FieldState; college: FieldState; majorGrade: FieldState };
  SOCIAL: { email: FieldState };
};

export const DEFAULT_ROSTER_FIELD_RULES: RosterFieldRules = {
  SCHOOL: { studentId: 'required', college: 'required', majorGrade: 'optional' },
  SOCIAL: { email: 'optional' },
};

export type RosterCell = string | number | boolean | Date | null | undefined;
export type RosterGrid = RosterCell[][];
export type RosterMerge = { s: { r: number; c: number }; e: { r: number; c: number } };

export type RosterEventOption = {
  id: string;
  type: string;
  label: string;
  isDouble: boolean;
  entrantType?: RosterTemplateKind;
};

export type RosterPerson = {
  row: number;
  name: string;
  gender: Gender | null;
  contact: string;
  unit: string;
  studentId?: string;
  college?: string;
  majorGrade?: string;
};

export type RosterEntry = {
  key: string;
  sheet: string;
  entrantType: RosterTemplateKind;
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
  studentId: number | null;
  college: number | null;
  majorGrade: number | null;
};

export type RosterSheetResult = {
  sheet: string;
  kind: RosterTemplateKind | null;
  headerRow: number | null;
  columns: RosterColumnMap | null;
  entries: RosterEntry[];
  skipped: number;
  messages: string[];
};

export type RosterImportPlayer = {
  row: number;
  entrantType: RosterTemplateKind;
  social: boolean;
  school: string;
  name: string;
  gender: Gender;
  contact: string;
  studentId?: string;
  college?: string;
  majorGrade?: string;
  className?: string;
  partnerName?: string;
  partnerGender?: Gender;
  partnerStudentId?: string;
  partnerSchool?: string;
  partnerCollege?: string;
  partnerMajorGrade?: string;
  partnerClassName?: string;
  partnerContact?: string;
  teamName?: string;
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

const ENTRANT_LABELS: Record<RosterTemplateKind, string> = {
  SCHOOL: '学生组',
  SOCIAL: '社会组',
};

// 模板自带的示例行。即使使用者把「序号」一列的“示例”删掉，也按姓名 + 联系方式识别并跳过。
const TEMPLATE_EXAMPLES = [
  { name: '黄太', contact: '13995646458' },
  { name: '丽人', contact: '412945668456' },
  { name: '好人', contact: '12398745695' },
];

type HeaderField = keyof RosterColumnMap;

const HEADER_PATTERNS: Array<{ field: HeaderField; test: RegExp }> = [
  { field: 'seq', test: /^(序号|编号|no\.?)$/i },
  { field: 'studentId', test: /学号|学生编号|学籍号/ },
  { field: 'college', test: /^(学院|院系|所在学院|系别)$/ },
  { field: 'majorGrade', test: /年级专业|专业年级|^(年级|专业|班级)$/ },
  { field: 'name', test: /姓名|名字/ },
  { field: 'gender', test: /^性别$/ },
  { field: 'contact', test: /联系方式|联系电话|电话|手机号?/ },
  { field: 'unit', test: /^单位|^学校$|所属单位|俱乐部|代表队/ },
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
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).replace(/\u00a0/g, ' ').trim();
}

/** 去空格、去括号内容、去标点，便于表头别名匹配。 */
export function normalizeHeaderText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s:：、，,。.\-—_/\\]/g, '')
    .trim();
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

export function entrantTypeLabel(kind: RosterTemplateKind | null | undefined): string {
  return kind ? ENTRANT_LABELS[kind] : '';
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

export function mapHeaderRow(row: RosterCell[]): Partial<RosterColumnMap> {
  const found: Partial<RosterColumnMap> = {};
  row.forEach((cell, c) => {
    const text = normalizeHeaderText(cellText(cell));
    if (!text) return;
    for (const pattern of HEADER_PATTERNS) {
      if ((found[pattern.field] as number | null | undefined) != null) continue;
      if (pattern.test.test(text)) {
        (found[pattern.field] as number) = c;
        break;
      }
    }
  });
  return found;
}

function hasBaseColumns(columns: Partial<RosterColumnMap>) {
  return (
    columns.name != null &&
    columns.gender != null &&
    columns.contact != null &&
    columns.unit != null &&
    columns.project != null
  );
}

export type RosterTemplateDetection = {
  kind: RosterTemplateKind;
  headerRow: number;
  columns: RosterColumnMap;
  messages: string[];
  error?: string;
};

export function detectTemplate(
  grid: RosterGrid,
  fieldRules: RosterFieldRules = DEFAULT_ROSTER_FIELD_RULES,
): RosterTemplateDetection | null {
  const limit = Math.min(grid.length, 30);
  for (let r = 0; r < limit; r += 1) {
    const row = grid[r] ?? [];
    const found = mapHeaderRow(row);
    if (!hasBaseColumns(found)) continue;

    const studentHits = ['studentId', 'college', 'majorGrade']
      .filter((key) => (found[key as HeaderField] as number | null | undefined) != null);
    const kind: RosterTemplateKind = studentHits.length ? 'SCHOOL' : 'SOCIAL';
    const title = `${cellText(grid[0]?.[0])} ${cellText(grid[1]?.[0])}`;
    const messages: string[] = [];
    let error: string | undefined;

    if (kind === 'SCHOOL') {
      if (studentHits.length && found.studentId == null) {
        error = '检测到学生字段，但缺少「学号」列，请使用官方学生模板';
      } else if (fieldRules.SCHOOL.studentId === 'required' && found.studentId == null) {
        error = '本赛事要求学号，但模板缺少「学号」列';
      } else if (fieldRules.SCHOOL.college === 'required' && found.college == null) {
        error = '本赛事要求学院，但模板缺少「学院」列';
      } else if (fieldRules.SCHOOL.majorGrade === 'required' && found.majorGrade == null) {
        error = '本赛事要求年级专业，但模板缺少「年级专业」列';
      }
      if (studentHits.length < 3 && !error) {
        messages.push('学生模板缺少部分学生字段列，缺失字段将按赛事配置留空');
      }
      if (title.includes('社会模板')) {
        messages.push('标题写的是社会模板，但表头包含学生字段，已按学生模板处理');
      }
    } else {
      if (title.includes('学生模板') && fieldRules.SCHOOL.studentId === 'required') {
        error = '标题是学生模板，但表头缺少学号/学院/年级专业列，请检查是否删列';
      }
      if (title.includes('学生模板') && !error) {
        messages.push('标题写的是学生模板，但表头只有基础列；已按社会模板处理，请确认');
      }
    }

    return {
      kind,
      headerRow: r,
      columns: {
        seq: found.seq ?? null,
        name: found.name!,
        gender: found.gender!,
        contact: found.contact!,
        unit: found.unit!,
        project: found.project!,
        studentId: found.studentId ?? null,
        college: found.college ?? null,
        majorGrade: found.majorGrade ?? null,
      },
      messages,
      error,
    };
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
    return first.gender === 'FEMALE' && second.gender === 'FEMALE' ? null : '女子双打两人性别必须为女';
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
  fieldRules?: RosterFieldRules;
  maxEventsPerPerson?: number;
  allowCrossEvent?: boolean;
}): RosterSheetResult {
  const { sheet, events } = input;
  const fieldRules = input.fieldRules ?? DEFAULT_ROSTER_FIELD_RULES;
  const maxEvents = input.maxEventsPerPerson ?? 2;
  const allowCross = input.allowCrossEvent ?? true;
  const grid = applyMerges(input.grid, input.merges);
  const detected = detectTemplate(grid, fieldRules);
  if (!detected) {
    return {
      sheet,
      kind: null,
      headerRow: null,
      columns: null,
      entries: [],
      skipped: 0,
      messages: ['没有找到表头：需要包含「姓名、性别、联系方式、单位、项目」五列的标题行，请使用官方模板。'],
    };
  }
  if (detected.error) {
    return {
      sheet,
      kind: detected.kind,
      headerRow: detected.headerRow + 1,
      columns: detected.columns,
      entries: [],
      skipped: 0,
      messages: [...detected.messages, detected.error],
    };
  }

  const { kind, columns } = detected;
  const entries: RosterEntry[] = [];
  const raws: RawRow[] = [];
  let skipped = 0;
  const read = (row: RosterCell[], column: number | null) =>
    column === null ? '' : cellText(row[column]);

  for (let r = detected.headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const name = read(row, columns.name);
    const genderText = read(row, columns.gender);
    const contact = normalizeContact(read(row, columns.contact));
    const unit = read(row, columns.unit);
    const project = read(row, columns.project);
    const seq = read(row, columns.seq);

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

    if (kind === 'SCHOOL') {
      const studentId = read(row, columns.studentId);
      const college = read(row, columns.college);
      const majorGrade = read(row, columns.majorGrade);
      if (columns.studentId === null && fieldRules.SCHOOL.studentId === 'required') {
        errors.push('本赛事要求学号，但模板缺少「学号」列');
      } else if (fieldRules.SCHOOL.studentId === 'required' && !studentId) {
        errors.push('学号不能为空');
      }
      if (columns.college === null && fieldRules.SCHOOL.college === 'required') {
        errors.push('本赛事要求学院，但模板缺少「学院」列');
      } else if (fieldRules.SCHOOL.college === 'required' && !college) {
        errors.push('学院不能为空');
      }
      if (columns.majorGrade === null && fieldRules.SCHOOL.majorGrade === 'required') {
        errors.push('本赛事要求年级专业，但模板缺少「年级专业」列');
      } else if (fieldRules.SCHOOL.majorGrade === 'required' && !majorGrade) {
        errors.push('年级专业不能为空');
      }
      person.studentId = studentId || undefined;
      person.college = college || undefined;
      person.majorGrade = majorGrade || undefined;
    }

    const eventType = projectToEventType(project);
    if (project && !eventType) {
      errors.push(`无法识别项目「${project}」，只能填写男子单打、女子单打、男子双打、女子双打、混合双打`);
    }
    const event = eventType
      ? events.find((item) => item.type === eventType && (item.entrantType ?? 'SCHOOL') === kind) ?? null
      : null;
    if (eventType && !event) {
      errors.push(
        `当前赛事未配置${ENTRANT_LABELS[kind]}「${eventTypeLabel(eventType) ?? project}」项目`,
      );
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

    const errors = [...raw.errors];
    if (raw.eventType && raw.event && !raw.event.isDouble) {
      const genderError = genderErrorFor(raw.event.type, [raw.person]);
      if (genderError) errors.push(genderError);
    }
    entries.push({
      key: `${sheet}-${kind}-${raw.row}`,
      sheet,
      entrantType: kind,
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
      if (kind === 'SCHOOL' && fieldRules.SCHOOL.studentId === 'required' && people[1] && !people[1].studentId) {
        errors.push(`第 ${people[1].row} 行搭档缺少学号`);
      }
    }
    entries.push({
      key: `${sheet}-${kind}-${group.map((raw) => raw.row).join('-')}`,
      sheet,
      entrantType: kind,
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
  markMaxEvents(entries, maxEvents, allowCross);
  entries.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0));

  return {
    sheet,
    kind,
    headerRow: detected.headerRow + 1,
    columns,
    entries,
    skipped,
    messages: detected.messages,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function personKey(kind: RosterTemplateKind, person: RosterPerson): string | null {
  if (kind === 'SCHOOL' && person.studentId) return `sid:${person.studentId}`;
  if (!person.name || !person.contact) return null;
  return `nc:${person.name}\u0000${person.contact}`;
}

function markDuplicates(entries: RosterEntry[]) {
  const seen = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.eventId) continue;
    for (const person of entry.people) {
      const key = personKey(entry.entrantType, person);
      if (!key) continue;
      const composite = `${entry.eventId}\u0000${key}`;
      const firstRow = seen.get(composite);
      if (firstRow === undefined) {
        seen.set(composite, person.row);
        continue;
      }
      if (firstRow !== person.row) {
        entry.errors.push(`与第 ${firstRow} 行重复：${person.name}（${person.contact}）`);
      }
    }
  }
}

function markMaxEvents(entries: RosterEntry[], maxEvents: number, allowCross: boolean) {
  const limit = allowCross ? maxEvents : 1;
  const counts = new Map<string, { name: string; rows: number[] }>();
  for (const entry of entries) {
    if (entry.errors.length || !entry.eventId) continue;
    for (const person of entry.people) {
      const key = personKey(entry.entrantType, person);
      if (!key) continue;
      const current = counts.get(key) ?? { name: person.name, rows: [] };
      current.rows.push(person.row);
      counts.set(key, current);
    }
  }
  for (const entry of entries) {
    if (entry.errors.length) continue;
    for (const person of entry.people) {
      const key = personKey(entry.entrantType, person);
      if (!key) continue;
      const item = counts.get(key);
      if (item && item.rows.length > limit) {
        entry.errors.push(`${person.name} 已报名 ${item.rows.length} 个项目，超过本赛事上限 ${limit} 个`);
      }
    }
  }
}

export function rosterImportGroups(entries: RosterEntry[]): Array<{
  eventId: string;
  entrantType: RosterTemplateKind;
  players: RosterImportPlayer[];
}> {
  const groups = new Map<string, { eventId: string; entrantType: RosterTemplateKind; players: RosterImportPlayer[] }>();
  for (const entry of entries) {
    if (entry.errors.length || !entry.eventId) continue;
    const [first, second] = entry.people;
    if (!first?.gender) continue;
    if (entry.kind === 'DOUBLE' && !second?.gender) continue;
    const isSchool = entry.entrantType === 'SCHOOL';
    const className = [first.college, first.majorGrade].filter(Boolean).join(' ') || undefined;
    const partnerClassName = second
      ? [second.college, second.majorGrade].filter(Boolean).join(' ') || undefined
      : undefined;
    const player: RosterImportPlayer = {
      row: entry.rows[0] ?? first.row,
      entrantType: entry.entrantType,
      social: !isSchool,
      school: entry.unit || first.unit,
      name: first.name,
      gender: first.gender,
      contact: first.contact,
      ...(isSchool
        ? {
            studentId: first.studentId,
            college: first.college,
            majorGrade: first.majorGrade,
            className,
          }
        : {}),
      ...(entry.kind === 'DOUBLE' && second
        ? {
            partnerName: second.name,
            partnerGender: second.gender as Gender,
            partnerContact: second.contact,
            ...(isSchool
              ? {
                  partnerStudentId: second.studentId,
                  partnerSchool: second.unit || first.unit,
                  partnerCollege: second.college || first.college,
                  partnerMajorGrade: second.majorGrade || first.majorGrade,
                  partnerClassName: partnerClassName || className,
                }
              : {}),
          }
        : {}),
    };
    const groupKey = `${entry.eventId}|${entry.entrantType}`;
    const group = groups.get(groupKey) ?? {
      eventId: entry.eventId,
      entrantType: entry.entrantType,
      players: [],
    };
    group.players.push(player);
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

export function rosterPeopleCount(entries: RosterEntry[]): number {
  return entries.reduce((total, entry) => total + entry.people.length, 0);
}
