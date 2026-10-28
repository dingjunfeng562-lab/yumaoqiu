import { EntrantType, EventType } from '@prisma/client';

export const ENTRANT_TYPE_LABELS: Record<EntrantType, string> = {
  [EntrantType.SCHOOL]: '学生组',
  [EntrantType.SOCIAL]: '社会组',
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  [EventType.MENS_SINGLES]: '男子单打',
  [EventType.WOMENS_SINGLES]: '女子单打',
  [EventType.MENS_DOUBLES]: '男子双打',
  [EventType.WOMENS_DOUBLES]: '女子双打',
  [EventType.MIXED_DOUBLES]: '混合双打',
};

export type FieldState = 'required' | 'optional' | 'hidden';

export type SchoolFieldRules = {
  studentId: FieldState;
  college: FieldState;
  majorGrade: FieldState;
};

export type SocialFieldRules = {
  email: FieldState;
};

export type RegistrationFieldRules = {
  SCHOOL: SchoolFieldRules;
  SOCIAL: SocialFieldRules;
};

export const DEFAULT_REGISTRATION_FIELD_RULES: RegistrationFieldRules = {
  SCHOOL: { studentId: 'required', college: 'required', majorGrade: 'optional' },
  SOCIAL: { email: 'optional' },
};

const FIELD_STATES: FieldState[] = ['required', 'optional', 'hidden'];

function normalizeState(value: unknown, fallback: FieldState): FieldState {
  return typeof value === 'string' && FIELD_STATES.includes(value as FieldState)
    ? (value as FieldState)
    : fallback;
}

/**
 * 把数据库里的 JSON 归一成完整规则。
 * 兼容旧数据/部分字段，缺省用默认值；非法值回退默认值。
 */
export function normalizeRegistrationFieldRules(value: unknown): RegistrationFieldRules {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const school = (source.SCHOOL ?? {}) as Record<string, unknown>;
  const social = (source.SOCIAL ?? {}) as Record<string, unknown>;
  const defaults = DEFAULT_REGISTRATION_FIELD_RULES;
  return {
    SCHOOL: {
      studentId: normalizeState(school.studentId, defaults.SCHOOL.studentId),
      college: normalizeState(school.college, defaults.SCHOOL.college),
      majorGrade: normalizeState(school.majorGrade, defaults.SCHOOL.majorGrade),
    },
    SOCIAL: {
      email: normalizeState(social.email, defaults.SOCIAL.email),
    },
  };
}

export function fieldRule(
  rules: RegistrationFieldRules,
  entrantType: EntrantType,
  field: string,
): FieldState {
  const group = rules[entrantType];
  if (!group) return 'optional';
  const value = (group as Record<string, FieldState>)[field];
  return value ?? 'optional';
}

export function isFieldRequired(
  rules: RegistrationFieldRules,
  entrantType: EntrantType,
  field: string,
): boolean {
  return fieldRule(rules, entrantType, field) === 'required';
}

export function isFieldVisible(
  rules: RegistrationFieldRules,
  entrantType: EntrantType,
  field: string,
): boolean {
  return fieldRule(rules, entrantType, field) !== 'hidden';
}

export function entrantTypeLabel(entrantType: EntrantType | null | undefined): string {
  return entrantType ? ENTRANT_TYPE_LABELS[entrantType] ?? entrantType : '';
}

export function eventTypeLabel(type: EventType): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

/**
 * 单项展示名：有组名时带前缀，旧赛事/未分组时不带。
 * 例：学生组 · 男子单打 / 男子单打
 */
export function eventDisplayLabel(event: {
  type: EventType;
  groupLabel?: string | null;
}): string {
  const label = eventTypeLabel(event.type);
  return event.groupLabel ? `${event.groupLabel} · ${label}` : label;
}

/** 报名身份 → 默认组名 */
export function defaultGroupLabel(entrantType: EntrantType): string {
  return ENTRANT_TYPE_LABELS[entrantType] ?? '';
}
