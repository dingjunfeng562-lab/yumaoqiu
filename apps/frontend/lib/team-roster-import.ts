// 团体队员导入解析：把粘贴的文本（或 Excel 表格）解析成「队员行 + 团体分组」。
//
// 支持的写法（列数不固定，只有团体名称和姓名必填）：
//   1. 标准列（Tab 或逗号/顿号分隔）：团体名称、姓名、性别、单位、联系方式、身份证号
//   2. 紧凑写法：零一队：张三（男），第二学校，13000000
//   3. 姓名后带性别：张三（男）、李四(女)
//   4. 带表头：首行含「团体/队伍/团队」和「姓名」时按表头识别列，顺序随意（可带序号列）
//
// 性别、单位、联系方式、身份证号可以留空或整列省略。第 3 列不是男/女时按「省略了性别列」
// 解析；但如果后面的列对不上（多半是性别写错了字），整行报错，不会把单位挪到电话里。
// 表头上方的标题行（如「××团体赛队员报名表」）会跳过，不会被当成表头。
// AI 识别的结果也会转成同样的文本走这里校验，保证只有一套导入规则。

export type TeamRosterGender = 'MALE' | 'FEMALE';

export type TeamRosterRow = {
  identityNumber?: string;
  lineNumber: number;
  teamName: string;
  name: string;
  gender?: TeamRosterGender;
  affiliation: string;
  contact: string;
  error?: string;
};

export type TeamRosterGroup = {
  teamName: string;
  count: number;
  male: number;
  female: number;
  lines: string;
  error?: string;
};

export type TeamRosterParse = {
  rows: TeamRosterRow[];
  groups: TeamRosterGroup[];
  valid: boolean;
};

export type TeamRosterColumns = {
  teamName: number;
  name: number;
  gender: number | null;
  affiliation: number | null;
  contact: number | null;
  identityNumber: number | null;
};

export type RosterMerge = { s: { r: number; c: number }; e: { r: number; c: number } };

const GENDER_ALIASES = new Map<string, TeamRosterGender>([
  ['男', 'MALE'], ['男子', 'MALE'], ['男生', 'MALE'], ['男性', 'MALE'], ['M', 'MALE'], ['MALE', 'MALE'],
  ['女', 'FEMALE'], ['女子', 'FEMALE'], ['女生', 'FEMALE'], ['女性', 'FEMALE'], ['F', 'FEMALE'], ['FEMALE', 'FEMALE'],
]);

const TEAM_COLUMN = /团体|队伍|团队|队名|代表队/;
const NAME_COLUMN = /姓名|名字|队员|选手/;
const AFFILIATION_COLUMN = /单位|学院|班级|学校|院系|所属/;
const CONTACT_COLUMN = /联系|电话|手机/;
const IDENTITY_COLUMN = /身份证|证件/;

/** 姓名末尾括注的性别，如「张三（男）」「李四(女)」。 */
const TRAILING_GENDER = /^(.*?)\s*[（(]\s*(男|女|男子|女子|男生|女生|男性|女性|M|F|MALE|FEMALE)\s*[)）]\s*$/i;
/** 「队名：姓名」写法；队名本身也可能带冒号（如「第二学校：一队」），由 isCompactLine 判断。 */
const TEAM_NAME_PREFIX = /^([^：:]{1,40})[：:]\s*(\S[\s\S]*)$/;
/** 只有数字和常见分隔符的单元格当成电话，不当单位。 */
const CONTACT_LIKE = /^[+\d][\d\s-]{4,}$/;
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 表头单元格一般很短；超过这个长度的多半是标题或填表说明。 */
const HEADER_CELL_MAX = 20;

function cleanCell(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim();
}

export function splitTeamRosterLine(line: string): string[] {
  const cells = (line.includes('\t') ? line.split('\t') : line.split(/[,，、]/)).map(cleanCell);
  // 只去掉行尾空列（Excel 复制时常带一个尾部 Tab），中间的空列保留用于识别缺列。
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  return cells;
}

export function parseTeamGender(value: string): TeamRosterGender | undefined {
  return GENDER_ALIASES.get(value.replace(/[\s（）()]/g, '').toUpperCase());
}

function splitNameGender(value: string): { name: string; gender?: TeamRosterGender } {
  const match = TRAILING_GENDER.exec(value.trim());
  if (!match) return { name: value.trim() };
  return { name: match[1].trim(), gender: parseTeamGender(match[2]) };
}

/**
 * 识别表头行。标题行（如「2026 年校园杯团体赛队员报名表」）会同时命中「团体」和「队员」，
 * Excel 里标题常常合并整行，每个单元格都是这句话。所以同时命中队名、姓名两类的单元格、
 * 过长的单元格都不当表头，队名列和姓名列也必须是不同的单元格；否则会把标题当成表头，
 * 导致每个人的姓名都变成队名。
 */
export function mapTeamRosterHeader(cells: string[]): TeamRosterColumns | null {
  const headerCell = (cell: string) =>
    cell.length <= HEADER_CELL_MAX && !(TEAM_COLUMN.test(cell) && NAME_COLUMN.test(cell));
  const teamName = cells.findIndex(cell => headerCell(cell) && TEAM_COLUMN.test(cell));
  const name = cells.findIndex((cell, index) => index !== teamName && headerCell(cell) && NAME_COLUMN.test(cell));
  if (teamName < 0 || name < 0) return null;
  // 每一列只认一次，避免「姓名（性别）」这类表头让性别列和姓名列指向同一格。
  const used = new Set([teamName, name]);
  const index = (pattern: RegExp) => {
    const found = cells.findIndex((cell, position) => !used.has(position) && pattern.test(cell));
    if (found < 0) return null;
    used.add(found);
    return found;
  };
  return {
    teamName,
    name,
    gender: index(/性别/),
    affiliation: index(AFFILIATION_COLUMN),
    contact: index(CONTACT_COLUMN),
    identityNumber: index(IDENTITY_COLUMN),
  };
}

function genderError(value: string) {
  return `性别「${value}」无法识别，请填写男或女`;
}

function requiredError(teamName: string, name: string) {
  if (!teamName || !name) return '团体名称和姓名必填';
  return undefined;
}

function parseColumnsRow(cells: string[], columns: TeamRosterColumns): Omit<TeamRosterRow, 'lineNumber'> {
  const at = (index: number | null) => (index === null ? '' : cells[index] ?? '');
  const teamName = at(columns.teamName);
  const { name, gender: nameGender } = splitNameGender(at(columns.name));
  const genderText = at(columns.gender);
  const gender = parseTeamGender(genderText) ?? nameGender;
  return {
    teamName,
    name,
    gender,
    affiliation: at(columns.affiliation),
    contact: at(columns.contact),
    identityNumber: at(columns.identityNumber) || undefined,
    error: requiredError(teamName, name) || (genderText && !gender ? genderError(genderText) : undefined),
  };
}

type LooseContext = {
  /** 原始行按 Tab 切出的列数（含行尾空列）；不是 Tab 分隔时为 0。 */
  tabColumns: number;
  /** 第 1 列的完整内容是否在多行里重复出现。 */
  firstCellRepeats: boolean;
};

/** 从带「序号」的 Excel 里粘贴时，去掉最前面的行号。 */
function stripSerial(cells: string[]) {
  return cells.length >= 3 && /^\d{1,3}$/.test(cells[0]) ? cells.slice(1) : cells;
}

function isContactCell(value: string) {
  return CONTACT_LIKE.test(value) || EMAIL_LIKE.test(value);
}

/**
 * 第 1 列带冒号时，判断是「队名：姓名」紧凑写法，还是队名本身带冒号（如「第二学校：一队」）。
 */
function isCompactLine(cells: string[], nameText: string, context: LooseContext) {
  // Excel、AI 识别结果转成的 Tab 文本每个字段各占一列（固定 6 列），队名带冒号也按整列处理。
  // 这里要看原始列数：行尾空列在切分时已被去掉，不能只看 cells.length。
  if (context.tabColumns >= 5 || cells.length > 4) return false;
  if (splitNameGender(nameText).gender) return true;          // 零一队：张三（男），第二学校
  if (cells[1] && parseTeamGender(cells[1])) return true;     // 零一队：张三，男，第二学校
  if (cells[2] && parseTeamGender(cells[2])) return false;    // 第二学校：一队，张三，男
  // 看不出来时看第 1 列是否在多行里重复：队名会重复，「队名：姓名」每行都不一样。
  return !context.firstCellRepeats;
}

function parseLooseRow(input: string[], context: LooseContext): Omit<TeamRosterRow, 'lineNumber'> {
  const cells = stripSerial(input);
  if (!cells.length) {
    return { teamName: '', name: '', affiliation: '', contact: '', error: '每行至少填写团体名称和姓名' };
  }

  const prefix = TEAM_NAME_PREFIX.exec(cells[0]);
  if (prefix && isCompactLine(cells, prefix[2], context)) {
    const teamName = prefix[1].trim();
    const { name, gender: nameGender } = splitNameGender(prefix[2]);
    let rest = cells.slice(1);
    let gender = nameGender;
    if (!gender && rest.length && parseTeamGender(rest[0])) {
      gender = parseTeamGender(rest[0]);
      rest = rest.slice(1);
    }
    return {
      teamName,
      name,
      gender,
      affiliation: rest[0] ?? '',
      contact: rest[1] ?? '',
      identityNumber: rest[2] || undefined,
      error: requiredError(teamName, name),
    };
  }

  const teamName = cells[0];
  const { name, gender: nameGender } = splitNameGender(cells[1] ?? '');
  const third = cells[2] ?? '';
  const thirdGender = parseTeamGender(third);
  // 第 3 列是男/女或空列时才认为「性别」这一列存在；否则说明省略了性别列，
  // 直接把后面的内容当成单位和联系方式，避免把「第二学校」当性别报错。
  const hasGenderColumn = cells.length > 2 && (!third || Boolean(thirdGender));

  if (cells.length > 6) {
    return {
      teamName, name, affiliation: '', contact: '',
      error: `最多 6 列（团体名称、姓名、性别、单位、联系方式、身份证号），当前 ${cells.length} 列`,
    };
  }
  if (!hasGenderColumn && cells.length >= 6) {
    return {
      teamName, name, affiliation: '', contact: '',
      error: `第 3 列应为性别（男/女），当前是「${third}」；可以留空，也可以写成「队名：姓名（男）」`,
    };
  }

  // 第 3 列不是性别时，按「省略了性别列」理解；但后面的列必须对得上，否则多半是性别写错了字
  // （如「难」），继续往后挪会把单位当电话、电话当身份证号，导入后才发现就晚了。
  if (!hasGenderColumn && cells.length > 2) {
    const thirdIsContact = CONTACT_LIKE.test(third);
    const misaligned = (third.length === 1 && !thirdIsContact)
      || (thirdIsContact && cells.length > 4)
      || (!thirdIsContact && Boolean(cells[3]) && !isContactCell(cells[3]));
    if (misaligned) {
      return {
        teamName, name, affiliation: '', contact: '',
        error: `第 3 列「${third}」不是性别（男/女），后面的列对不上；请按团体名称、姓名、性别、单位、联系方式、身份证号的顺序填写，性别可以留空，但要保留这一列`,
      };
    }
  }

  const gender = thirdGender ?? nameGender;
  let affiliation = '';
  let contact = '';
  let identityNumber = '';
  if (hasGenderColumn) {
    affiliation = cells[3] ?? '';
    contact = cells[4] ?? '';
    identityNumber = cells[5] ?? '';
  } else if (CONTACT_LIKE.test(third)) {
    // 性别和单位都省略：第 3 列就是联系方式，后面是身份证号。
    contact = third;
    identityNumber = cells[3] ?? '';
  } else {
    affiliation = cells[2] ?? '';
    contact = cells[3] ?? '';
    identityNumber = cells[4] ?? '';
  }

  return {
    teamName,
    name,
    gender,
    affiliation,
    contact,
    identityNumber: identityNumber || undefined,
    error: requiredError(teamName, name),
  };
}

export function parseTeamRoster(text: string): TeamRosterParse {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const content = lines
    .map((line, index) => ({ line, index }))
    .filter(item => item.line.trim());

  // 表头可能在第 1 行，也可能上面还有一行标题；只在开头 10 行内找。
  let columns: TeamRosterColumns | null = null;
  let headerIndex = -1;
  for (const item of content.slice(0, 10)) {
    const mapped = mapTeamRosterHeader(splitTeamRosterLine(item.line));
    if (mapped) {
      columns = mapped;
      headerIndex = item.index;
      break;
    }
  }

  // 表头及其上方的标题行不参与导入。
  const data = content
    .filter(item => item.index > headerIndex)
    .map(item => ({
      index: item.index,
      cells: splitTeamRosterLine(item.line),
      tabColumns: item.line.includes('\t') ? item.line.split('\t').length : 0,
    }));
  const firstCellCount = new Map<string, number>();
  if (!columns) {
    for (const item of data) {
      const first = stripSerial(item.cells)[0];
      if (first) firstCellCount.set(first, (firstCellCount.get(first) ?? 0) + 1);
    }
  }

  const rows: TeamRosterRow[] = [];
  for (const item of data) {
    const parsed = columns
      ? parseColumnsRow(item.cells, columns)
      : parseLooseRow(item.cells, {
          tabColumns: item.tabColumns,
          firstCellRepeats: (firstCellCount.get(stripSerial(item.cells)[0] ?? '') ?? 0) > 1,
        });
    rows.push({ lineNumber: item.index + 1, ...parsed });
  }

  return summarizeTeamRoster(rows);
}

function summarizeTeamRoster(rows: TeamRosterRow[]): TeamRosterParse {
  const grouped = new Map<string, TeamRosterRow[]>();
  for (const row of rows) {
    if (!row.teamName) continue;
    const members = grouped.get(row.teamName) ?? [];
    members.push(row);
    grouped.set(row.teamName, members);
  }
  const groups: TeamRosterGroup[] = [...grouped].map(([teamName, members]) => ({
    teamName,
    count: members.length,
    male: members.filter(row => row.gender === 'MALE').length,
    female: members.filter(row => row.gender === 'FEMALE').length,
    lines: members.map(row => row.lineNumber).join('、'),
    error: members.some(row => row.error) ? '请修正下方行数据' : undefined,
  }));

  return { rows, groups, valid: rows.length > 0 && rows.every(row => !row.error) };
}

export type TeamRosterFieldState = 'hidden' | 'optional' | 'required';

/** 团体赛所属组别的报名字段（后端 GET /team-competitions/:id/roster-fields）。 */
export type TeamRosterFieldRules = {
  groupName: string | null;
  gender: TeamRosterFieldState;
  identityNumber: TeamRosterFieldState;
  /** 本组个人报名会收集、但团体赛导入不收集的字段。 */
  notCollected: string[];
};

/**
 * 按组别报名字段补充校验：性别、身份证号设为必填时没填就报错。
 * 后端导入时也会这样校验，而且一行不合格整批都导入失败，所以在预览里提前标出来。
 */
export function applyTeamRosterFieldRules(parse: TeamRosterParse, rules: TeamRosterFieldRules | null): TeamRosterParse {
  if (!rules) return parse;
  const rows = parse.rows.map(row => {
    if (row.error) return row;
    const missing = [
      ...(rules.gender === 'required' && !row.gender ? ['性别'] : []),
      ...(rules.identityNumber === 'required' && !row.identityNumber ? ['身份证号'] : []),
    ];
    return missing.length ? { ...row, error: `本组要求填写${missing.join('和')}` } : row;
  });
  return summarizeTeamRoster(rows);
}

/** 把队员行还原成「Tab 分隔、6 列」的文本，交给同一个解析器校验和预览。 */
export function rowsToTeamRosterText(rows: TeamRosterRow[]): string {
  return rows
    .map(row => [
      row.teamName,
      row.name,
      row.gender === 'MALE' ? '男' : row.gender === 'FEMALE' ? '女' : '',
      row.affiliation,
      row.contact,
      row.identityNumber ?? '',
    ].join('\t'))
    .join('\n');
}

function gridCellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return String(value).replace(/\u00a0/g, ' ').trim();
}

/**
 * Excel 表格 → 队员文本。
 * 先按合并区域补全单元格，再按表头定位队名列做向下填充：队名只写一次时，
 * 下面的队员也能归到同一支队伍。
 */
export function gridToTeamRosterText(grid: unknown[][], merges: RosterMerge[] = []): string {
  const rows = grid.map(row => row.map(gridCellText));
  for (const merge of merges) {
    const value = rows[merge.s.r]?.[merge.s.c];
    if (!value) continue;
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        if (rows[r] && !rows[r][c]) rows[r][c] = value;
      }
    }
  }

  let headerRow = -1;
  let columns: TeamRosterColumns | null = null;
  for (let r = 0; r < Math.min(20, rows.length); r += 1) {
    const mapped = mapTeamRosterHeader(rows[r]);
    if (mapped) {
      headerRow = r;
      columns = mapped;
      break;
    }
  }
  const teamColumn = columns?.teamName ?? 0;
  let lastTeam = '';
  const lines: string[] = [];
  rows.forEach((cells, r) => {
    if (!cells.some(Boolean)) return;
    if (r !== headerRow && (headerRow < 0 || r > headerRow)) {
      if (!cells[teamColumn] && lastTeam) cells[teamColumn] = lastTeam;
      else if (cells[teamColumn]) lastTeam = cells[teamColumn];
    }
    lines.push(cells.join('\t'));
  });
  return lines.join('\n');
}
