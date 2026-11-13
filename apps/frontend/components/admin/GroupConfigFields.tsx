'use client';

import { Alert, Checkbox, DatePicker, Form, Input, InputNumber, Radio, Select, Switch, Tag, Typography, type FormInstance } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import {
  CN_DATE_FORMAT,
  GROUP_EVENT_OPTIONS,
  birthRangeFromAges,
  birthRangeText,
  cnDate,
  type AgeRule,
  type FieldState,
  type GroupFields,
} from '@/lib/registration-groups';

/** 界面上的年龄要求：BY_AGE = 按年龄（保存为出生日期范围 + 原始年龄）；AGE 只给旧组别回显。 */
export type AgeMode = 'NONE' | 'BY_AGE' | 'BIRTH_DATE' | 'AGE';

export type GroupAgeForm = {
  mode: AgeMode;
  basis: 'YEAR' | 'AGE';
  minAge?: number | null;
  maxAge?: number | null;
  refDate?: string;
  minDate?: string;
  maxDate?: string;
  minInclusive: boolean;
  maxInclusive: boolean;
  cutoffDate?: string;
};

export type GroupFormValues = {
  /** 已保存的组别才有 id；新增的没有。 */
  id?: string;
  /** 默认学生组（旧数据）：始终按学生处理。 */
  legacy?: boolean;
  /** 已有报名：年龄要求和报名字段锁定。 */
  locked?: boolean;
  name: string;
  categoryLabel?: string;
  enabled: boolean;
  fieldRules: GroupFields;
  age: GroupAgeForm;
  eventTypes: string[];
  paymentEnabled: boolean;
  singlesYuan: number;
  doublesYuan: number;
  teamYuan: number;
  paymentInstructions?: string;
  /** 本组总人数上限，空为不限。 */
  maxEntrants?: number | null;
  /** 各项目名额，键为项目类型：单打按人、双打按队；空为不限。 */
  eventCaps?: Record<string, number | null | undefined>;
  /** 已报人数、各项目已占名额：只用于显示，不提交。 */
  entrantCount?: number;
  entryCounts?: Record<string, number>;
};

/** 接口返回的组别（只列这里用到的字段）。 */
export type GroupSource = {
  id: string;
  legacyType?: string | null;
  name: string;
  categoryLabel?: string | null;
  enabled: boolean;
  fieldRules: GroupFields;
  ageRule: AgeRule;
  events: Array<{ type: string; maxEntries?: number | null; entryCount?: number }>;
  payment?: { enabled: boolean; singlesFee: number; doublesFee: number; teamFee: number; instructions?: string | null } | null;
  maxEntrants?: number | null;
  entrantCount?: number;
  _count?: { applications: number };
};

const DOUBLES_TYPES = new Set(['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES']);

/** 名额单位：单打按人，双打按队。 */
export function entryUnit(type: string) {
  return DOUBLES_TYPES.has(type) ? '队' : '人';
}

/** 学生预设：收学号、学院；第三方（空白组别）：姓名、性别、单位、年龄、联系方式、身份证号、衣服尺寸。 */
export function presetFields(kind: 'STUDENT' | 'THIRD_PARTY'): GroupFields {
  return kind === 'STUDENT'
    ? { identityNumber: 'optional', gender: 'optional', studentId: 'required', college: 'required', majorGrade: 'optional', email: 'optional', age: 'hidden', shirtSize: 'hidden' }
    : { identityNumber: 'optional', gender: 'optional', studentId: 'hidden', college: 'hidden', majorGrade: 'hidden', email: 'hidden', age: 'required', shirtSize: 'optional' };
}

/** 收集学号的组按学生处理（学号查重、统计高校），否则按第三方处理；默认学生组始终按学生处理。 */
export function isStudentGroup(values: { legacy?: boolean; fieldRules?: Partial<GroupFields> }) {
  return Boolean(values.legacy) || (values.fieldRules?.studentId ?? 'hidden') !== 'hidden';
}

function today() {
  return dayjs().format('YYYY-MM-DD');
}

export type GroupPreset = { kind: 'BLANK' } | { kind: 'STUDENT' } | { kind: 'U'; age: number };

export function newGroupValues(refDate?: string, preset: GroupPreset = { kind: 'BLANK' }): GroupFormValues {
  const base: GroupFormValues = {
    name: '',
    enabled: true,
    fieldRules: presetFields('THIRD_PARTY'),
    age: { mode: 'NONE', basis: 'YEAR', refDate: refDate ?? today(), minInclusive: true, maxInclusive: true },
    eventTypes: [],
    paymentEnabled: false,
    singlesYuan: 0,
    doublesYuan: 0,
    teamYuan: 0,
    maxEntrants: null,
    eventCaps: {},
  };
  if (preset.kind === 'STUDENT') return { ...base, name: '学生组', fieldRules: presetFields('STUDENT') };
  // U8 = 未满 9 岁，即 8 岁及以下。
  if (preset.kind === 'U') return { ...base, name: `U${preset.age}`, age: { ...base.age, mode: 'BY_AGE', maxAge: preset.age } };
  return base;
}

export function groupToFormValues(group: GroupSource, refDate?: string): GroupFormValues {
  const rule = group.ageRule ?? { mode: 'NONE' };
  const legacy = Boolean(group.legacyType);
  return {
    id: group.id,
    legacy,
    locked: (group._count?.applications ?? 0) > 0,
    name: group.name,
    categoryLabel: group.categoryLabel ?? undefined,
    enabled: group.enabled,
    fieldRules: { ...presetFields(legacy ? 'STUDENT' : 'THIRD_PARTY'), ...group.fieldRules },
    age: {
      mode: rule.mode === 'BIRTH_DATE' && rule.ageInput ? 'BY_AGE' : rule.mode,
      basis: rule.ageInput?.basis ?? 'YEAR',
      minAge: rule.ageInput ? rule.ageInput.minAge : rule.minAge,
      maxAge: rule.ageInput ? rule.ageInput.maxAge : rule.maxAge,
      refDate: rule.ageInput?.refDate ?? refDate ?? today(),
      minDate: rule.minDate,
      maxDate: rule.maxDate,
      minInclusive: rule.minInclusive !== false,
      maxInclusive: rule.maxInclusive !== false,
      cutoffDate: rule.cutoffDate,
    },
    eventTypes: group.events.map((event) => event.type),
    paymentEnabled: group.payment?.enabled ?? false,
    singlesYuan: (group.payment?.singlesFee ?? 0) / 100,
    doublesYuan: (group.payment?.doublesFee ?? 0) / 100,
    teamYuan: (group.payment?.teamFee ?? 0) / 100,
    paymentInstructions: group.payment?.instructions ?? undefined,
    maxEntrants: group.maxEntrants ?? null,
    eventCaps: Object.fromEntries(group.events.map((event) => [event.type, event.maxEntries ?? null])),
    entrantCount: group.entrantCount,
    entryCounts: Object.fromEntries(group.events.map((event) => [event.type, event.entryCount ?? 0])),
  };
}

const present = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

export function toAgeRule(age: GroupAgeForm | undefined): AgeRule {
  if (!age || age.mode === 'NONE') return { mode: 'NONE' };
  if (age.mode === 'BY_AGE') {
    // 出生日期范围由服务端按年龄换算。
    return {
      mode: 'BIRTH_DATE',
      ageInput: {
        basis: age.basis ?? 'YEAR',
        ...(present(age.minAge) ? { minAge: age.minAge } : {}),
        ...(present(age.maxAge) ? { maxAge: age.maxAge } : {}),
        refDate: age.refDate ?? today(),
      },
    };
  }
  if (age.mode === 'BIRTH_DATE') {
    return { mode: 'BIRTH_DATE', minDate: age.minDate || undefined, maxDate: age.maxDate || undefined, minInclusive: age.minInclusive !== false, maxInclusive: age.maxInclusive !== false };
  }
  return {
    mode: 'AGE',
    ...(present(age.minAge) ? { minAge: age.minAge } : {}),
    ...(present(age.maxAge) ? { maxAge: age.maxAge } : {}),
    cutoffDate: age.cutoffDate,
    minInclusive: age.minInclusive !== false,
    maxInclusive: age.maxInclusive !== false,
  };
}

/** 表单值 → 保存组别的接口参数（金额转成分）。字段模板由服务端按是否收集学号判断。 */
export function groupPayload(values: GroupFormValues) {
  return {
    name: values.name.trim(),
    categoryLabel: values.categoryLabel?.trim() || undefined,
    fieldTemplate: isStudentGroup(values) ? 'SCHOOL' : 'GENERAL',
    enabled: values.enabled ?? true,
    fieldRules: values.fieldRules ?? {},
    ageRule: toAgeRule(values.age),
    eventTypes: values.eventTypes,
    paymentEnabled: Boolean(values.paymentEnabled),
    singlesFee: Math.round((values.singlesYuan ?? 0) * 100),
    doublesFee: Math.round((values.doublesYuan ?? 0) * 100),
    teamFee: Math.round((values.teamYuan ?? 0) * 100),
    paymentInstructions: values.paymentInstructions?.trim() || undefined,
    // 名额：空为不限（传 null 清空）；只提交勾选的项目。
    maxEntrants: values.maxEntrants ?? null,
    eventCaps: Object.fromEntries((values.eventTypes ?? []).map((type) => [type, values.eventCaps?.[type] ?? null])),
  };
}

/** 可配置的报名字段，按报名表上的顺序排列；姓名、联系方式、学校/单位固定必填。 */
const FIELD_ROWS: Array<{ key: keyof GroupFields; label: string; hint?: string }> = [
  { key: 'gender', label: '性别' },
  { key: 'age', label: '年龄', hint: '填了身份证号会自动计算' },
  { key: 'identityNumber', label: '身份证号', hint: '用于计算年龄和资格核验' },
  { key: 'studentId', label: '学号', hint: '收集学号的组按学生报名处理' },
  { key: 'college', label: '学院' },
  { key: 'majorGrade', label: '年级专业' },
  { key: 'shirtSize', label: '衣服尺寸', hint: '报名人自己填写' },
  { key: 'email', label: '邮箱', hint: '用于接收审核结果' },
];

const FIELD_STATE_OPTIONS: Array<{ value: FieldState; label: string }> = [
  { value: 'required', label: '必填' },
  { value: 'optional', label: '选填' },
  { value: 'hidden', label: '不收集' },
];

const U_SERIES = Array.from({ length: 13 }, (_, index) => index + 6);

const dateProps = {
  getValueProps: (value?: string) => ({ value: value ? dayjs(value) : null }),
  getValueFromEvent: (value: dayjs.Dayjs | null) => value?.format('YYYY-MM-DD'),
};

function ChineseDatePicker(props: React.ComponentProps<typeof DatePicker>) {
  return <DatePicker locale={zhCN.DatePicker} format={CN_DATE_FORMAT} style={{ width: '100%' }} {...props} />;
}

/** 只为在表单里登记 id、legacy、locked 这类不显示的值，让联动和校验都拿得到。 */
function HiddenValue(): null {
  return null;
}

function SectionTitle({ index, title, extra }: { index: string; title: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-2 flex items-center gap-2 border-b border-slate-100 pb-2">
      <Typography.Text strong>{index} {title}</Typography.Text>
      {extra}
    </div>
  );
}

/**
 * 一个组别的设置，按「① 组别 → ② 比赛项目 → ③ 报名字段 → ④ 报名设置」排列。
 * prefix 是 Form.Item 的相对名称（Form.List 里为 [field.name]），
 * path 是在整个表单里的绝对路径（Form.List 里为 ['groups', field.name]），用于联动。
 */
export function GroupConfigFields({
  form,
  prefix = [],
  path = [],
  refDate,
  showPayment = true,
}: {
  form: FormInstance;
  prefix?: Array<string | number>;
  path?: Array<string | number>;
  /** 年龄参照日期的默认值：赛事开始日。 */
  refDate?: string;
  showPayment?: boolean;
}) {
  const n = (...keys: Array<string | number>) => [...prefix, ...keys];
  const abs = (...keys: Array<string | number>) => [...path, ...keys];
  const age = (Form.useWatch(abs('age'), form) ?? {}) as Partial<GroupAgeForm>;
  const fieldRules = Form.useWatch(abs('fieldRules'), form) as Partial<GroupFields> | undefined;
  const legacy = Boolean(Form.useWatch(abs('legacy'), form));
  const locked = Boolean(Form.useWatch(abs('locked'), form));
  const paymentEnabled = Form.useWatch(abs('paymentEnabled'), form);
  const selectedTypes = (Form.useWatch(abs('eventTypes'), form) ?? []) as string[];
  const entryCounts = Form.useWatch(abs('entryCounts'), form) as Record<string, number> | undefined;
  const entrantCount = Form.useWatch(abs('entrantCount'), form) as number | undefined;
  const mode = age.mode ?? 'NONE';
  const student = isStudentGroup({ legacy, fieldRules });
  const preview = mode === 'BY_AGE' && (present(age.minAge) || present(age.maxAge)) && age.refDate
    && !(present(age.minAge) && present(age.maxAge) && age.minAge > age.maxAge)
    ? birthRangeText(birthRangeFromAges({ basis: age.basis ?? 'YEAR', minAge: present(age.minAge) ? age.minAge : undefined, maxAge: present(age.maxAge) ? age.maxAge : undefined, refDate: age.refDate }))
    : '';

  function quickFill(value: number) {
    form.setFieldValue(abs('age', 'minAge'), undefined);
    form.setFieldValue(abs('age', 'maxAge'), value);
    if (!String(form.getFieldValue(abs('name')) ?? '').trim()) form.setFieldValue(abs('name'), `U${value}`);
  }

  return (
    <>
      {(['id', 'legacy', 'locked', 'entrantCount', 'entryCounts'] as const).map((key) => (
        <Form.Item key={key} name={n(key)} noStyle>
          <HiddenValue />
        </Form.Item>
      ))}
      {locked ? (
        <Alert type="warning" showIcon title="本组已有报名，年龄要求和报名字段已锁定；名称、项目、名额、开放报名和收费仍可修改。" style={{ marginBottom: 12 }} />
      ) : null}

      <SectionTitle index="①" title="组别" />
      <div className="grid gap-x-4 md:grid-cols-2">
        <Form.Item name={n('name')} label="组别名称" rules={[{ required: true, whitespace: true, message: '请填写组别名称' }]}>
          <Input maxLength={60} placeholder="例如 学生组、U8、成人组·35-44岁" />
        </Form.Item>
        <Form.Item name={n('categoryLabel')} label="参赛类别（选填）">
          <Input maxLength={60} placeholder="学生 / 第三方 / 青少年 / 自定义" />
        </Form.Item>
      </div>
      <Form.Item name={n('age', 'mode')} label="年龄要求">
        <Select
          disabled={locked}
          onChange={(value: AgeMode) => {
            if (value === 'BY_AGE' && !form.getFieldValue(abs('age', 'refDate'))) form.setFieldValue(abs('age', 'refDate'), refDate ?? today());
            if (value === 'BY_AGE' && !form.getFieldValue(abs('age', 'basis'))) form.setFieldValue(abs('age', 'basis'), 'YEAR');
          }}
          options={[
            { value: 'NONE', label: '不限年龄' },
            { value: 'BY_AGE', label: '按年龄（自动推算出生日期）' },
            { value: 'BIRTH_DATE', label: '自定义出生日期范围' },
            ...(mode === 'AGE' ? [{ value: 'AGE', label: '指定日期的周岁（旧设置）' }] : []),
          ]}
        />
      </Form.Item>

      {mode === 'BY_AGE' ? (
        <div className="mb-4 rounded-lg border border-slate-200 p-4">
          <div className="grid gap-x-4 md:grid-cols-3">
            <Form.Item label="U 系列快捷填写" extra="U8 = 未满 9 岁（8 岁及以下）">
              <Select disabled={locked} placeholder="选择后自动填写最大年龄" allowClear options={U_SERIES.map((value) => ({ value, label: `U${value}` }))} onChange={(value?: number) => { if (value) quickFill(value); }} />
            </Form.Item>
            <Form.Item
              name={n('age', 'minAge')}
              label="最小年龄（选填）"
              dependencies={[abs('age', 'maxAge')]}
              rules={[{
                validator: (_, value?: number | null) => {
                  const max = form.getFieldValue(abs('age', 'maxAge'));
                  if (!present(value) && !present(max)) return Promise.reject(new Error('请至少填写最小年龄或最大年龄'));
                  if (present(value) && present(max) && value > max) return Promise.reject(new Error('最小年龄不能大于最大年龄'));
                  return Promise.resolve();
                },
              }]}
            >
              <InputNumber disabled={locked} min={0} max={150} precision={0} suffix="岁" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name={n('age', 'maxAge')} label="最大年龄（选填）">
              <InputNumber disabled={locked} min={0} max={150} precision={0} suffix="岁" style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div className="grid gap-x-4 md:grid-cols-2">
            <Form.Item name={n('age', 'basis')} label="计算方式">
              <Radio.Group
                disabled={locked}
                options={[
                  { value: 'YEAR', label: '按出生年份' },
                  { value: 'AGE', label: '按周岁' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name={n('age', 'refDate')}
              label={age.basis === 'AGE' ? '以哪天计周岁' : '参照日期（取所在年份）'}
              rules={[{ required: true, message: '请选择参照日期' }]}
              extra={age.basis === 'AGE' ? '默认赛事开始日' : `年龄 = ${age.refDate ? age.refDate.slice(0, 4) : '参照年份'} − 出生年份`}
              {...dateProps}
            >
              <ChineseDatePicker disabled={locked} allowClear={false} />
            </Form.Item>
          </div>
          {preview ? (
            <Alert type="success" showIcon title={`对应出生日期：${preview}`} />
          ) : (
            <Typography.Text type="secondary">填写年龄后自动推算出生日期范围。</Typography.Text>
          )}
        </div>
      ) : null}

      {mode === 'BIRTH_DATE' ? (
        <>
          <div className="grid gap-x-4 md:grid-cols-2">
            <Form.Item name={n('age', 'minDate')} label="最早出生日期" {...dateProps}><ChineseDatePicker disabled={locked} /></Form.Item>
            <Form.Item name={n('age', 'maxDate')} label="最晚出生日期" {...dateProps}><ChineseDatePicker disabled={locked} /></Form.Item>
          </div>
          <div className="flex gap-4">
            <Form.Item name={n('age', 'minInclusive')} valuePropName="checked"><Checkbox disabled={locked}>包含最早日期当天</Checkbox></Form.Item>
            <Form.Item name={n('age', 'maxInclusive')} valuePropName="checked"><Checkbox disabled={locked}>包含最晚日期当天</Checkbox></Form.Item>
          </div>
        </>
      ) : null}

      {mode === 'AGE' ? (
        <>
          <div className="grid gap-x-4 md:grid-cols-3">
            <Form.Item name={n('age', 'minAge')} label="最低周岁"><InputNumber disabled={locked} min={0} max={150} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name={n('age', 'maxAge')} label="最高周岁"><InputNumber disabled={locked} min={0} max={150} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name={n('age', 'cutoffDate')} label="年龄计算截止日" rules={[{ required: true, message: '请选择截止日' }]} {...dateProps}><ChineseDatePicker disabled={locked} /></Form.Item>
          </div>
          <div className="flex gap-4">
            <Form.Item name={n('age', 'minInclusive')} valuePropName="checked"><Checkbox disabled={locked}>包含最低周岁</Checkbox></Form.Item>
            <Form.Item name={n('age', 'maxInclusive')} valuePropName="checked"><Checkbox disabled={locked}>包含最高周岁</Checkbox></Form.Item>
          </div>
          <Typography.Paragraph type="secondary">
            按周岁计算；2月29日出生者在非闰年按3月1日达到新周岁。{age.cutoffDate ? `当前以${cnDate(age.cutoffDate)}为准。` : ''}
          </Typography.Paragraph>
        </>
      ) : null}

      <SectionTitle index="②" title="比赛项目" />
      <Form.Item name={n('eventTypes')} rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个项目' }]}>
        <Checkbox.Group options={GROUP_EVENT_OPTIONS} />
      </Form.Item>
      {selectedTypes.length ? (
        <div className="mb-4 rounded-lg border border-slate-200 px-4 pb-1 pt-3">
          <Typography.Text strong>项目名额（选填）</Typography.Text>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
            单打按人、双打按队计，待审核和已通过都占名额，驳回、删除的让出名额；留空不限。只限制扫码报名，后台添加不受限制。
          </div>
          <div className="grid gap-x-6 md:grid-cols-2">
            {GROUP_EVENT_OPTIONS.filter((option) => selectedTypes.includes(option.value)).map((option) => {
              const unit = entryUnit(option.value);
              const used = entryCounts?.[option.value];
              return (
                <div key={option.value} className="flex items-center gap-3">
                  <Typography.Text style={{ width: 64, flexShrink: 0 }}>{option.label}</Typography.Text>
                  <Form.Item name={n('eventCaps', option.value)} style={{ marginBottom: 8 }}>
                    <InputNumber min={1} max={100000} precision={0} placeholder="不限" suffix={unit} style={{ width: 130 }} />
                  </Form.Item>
                  {used != null ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>已报 {used} {unit}</Typography.Text>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <SectionTitle
        index="③"
        title="报名字段"
        extra={<Tag color={student ? 'geekblue' : 'orange'} style={{ marginInlineStart: 4 }}>{student ? '按学生报名（学号查重）' : '按第三方报名（姓名 + 联系方式查重）'}</Tag>}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        姓名、联系方式、{student ? '学校' : '单位'}固定必填。收集学号的组按学生处理，否则按第三方处理。
      </Typography.Paragraph>
      <div className="mb-2 grid gap-x-6 gap-y-1 md:grid-cols-2">
        {FIELD_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Typography.Text>{row.label}</Typography.Text>
              {row.hint ? <div style={{ fontSize: 12, color: '#94a3b8' }}>{row.hint}</div> : null}
            </div>
            <Form.Item name={n('fieldRules', row.key)} style={{ marginBottom: 8 }}>
              <Radio.Group disabled={locked} optionType="button" buttonStyle="solid" size="small" options={FIELD_STATE_OPTIONS} />
            </Form.Item>
          </div>
        ))}
      </div>

      <SectionTitle index="④" title="报名设置" />
      <Form.Item name={n('enabled')} label="开放本组报名" valuePropName="checked" extra="关闭后，报名人扫码时看不到本组。">
        <Switch />
      </Form.Item>
      <Form.Item
        name={n('maxEntrants')}
        label="本组总人数上限（选填）"
        extra={`一人一份报名，报几个项目都算 1 人，双打搭档不另算；待审核和已通过都占名额，留空不限。满了以后新的人报不进来，已报名的选手仍可追加项目。只限制扫码报名，后台添加不受限制。${entrantCount != null ? `当前已报 ${entrantCount} 人。` : ''}`}
      >
        <InputNumber min={1} max={100000} precision={0} placeholder="不限" suffix="人" style={{ width: 200 }} />
      </Form.Item>
      {showPayment ? (
        <>
          <Form.Item name={n('paymentEnabled')} label="开启收费" valuePropName="checked"><Switch /></Form.Item>
          {paymentEnabled ? (
            <>
              <div className="grid gap-x-4 md:grid-cols-3">
                {(['singlesYuan', 'doublesYuan', 'teamYuan'] as const).map((key, index) => (
                  <Form.Item key={key} name={n(key)} label={['单打（元/人）', '双打（元/对）', '团体（元/队）'][index]}>
                    <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                  </Form.Item>
                ))}
              </div>
              <Form.Item name={n('paymentInstructions')} label="收款说明">
                <Input.TextArea rows={3} placeholder="收款账号、转账备注等；收款码可在缴费管理中设置" />
              </Form.Item>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
