'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Checkbox, Divider, Form, InputNumber, Modal, Radio, Select, Space, Table, Tag, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';
import {
  SCORING_MODE_LABELS,
  SCORING_RULE_LABELS,
  applyScoringPatch,
  defaultRuleSummary,
  planBatchScoring,
  ruleChoiceError,
  stageRuleSummary,
  type BatchPlan,
  type BatchScoringChange,
  type RuleChoice,
  type ScoringEvent,
  type StageChoice,
} from '@/lib/event-batch-scoring';

type StageDef = { key: string; label: string; description: string };

type FormValues = Record<string, unknown> & {
  changeDefault?: boolean;
  defaultMethod?: 'preset' | 'custom';
  defaultRule?: string;
  defaultPoint?: number | null;
  defaultCap?: number | null;
  defaultGames?: number | null;
  changeMode?: boolean;
  scoringMode?: string;
};

interface Props<T extends ScoringEvent> {
  tournamentId: string;
  token?: string;
  /** 勾选的单项。 */
  events: T[];
  /** 全部阶段，按展示顺序。 */
  stages: readonly StageDef[];
  /** 某个赛制下可以设置的阶段 key（与单个编辑一致）。 */
  stageKeysFor: (format: string) => readonly string[];
  labelOf: (event: T) => string;
  onClose: () => void;
  /** 保存过（不论全部成功与否）后刷新单项列表。 */
  onSaved: () => Promise<void> | void;
}

const RULE_OPTIONS = Object.entries(SCORING_RULE_LABELS).map(([value, label]) => ({ value, label }));
const EMPTY_VALUES: FormValues = {};

function customChoice(point: unknown, cap: unknown, games: unknown): RuleChoice {
  return {
    kind: 'custom',
    point: Number(point ?? 0),
    cap: cap == null || cap === '' ? null : Number(cap),
    gamesToWin: Number(games ?? 0),
  };
}

/** 把表单值换成改法；同时收集没填完整的地方。 */
function toChange(values: FormValues, stages: readonly StageDef[]) {
  const errors: string[] = [];
  const change: BatchScoringChange = { stages: {} };
  if (values.changeDefault) {
    const rule: RuleChoice = values.defaultMethod === 'custom'
      ? customChoice(values.defaultPoint, values.defaultCap, values.defaultGames)
      : { kind: 'preset', scoringRule: String(values.defaultRule ?? '') };
    const error = ruleChoiceError(rule);
    if (error) errors.push(`默认规则：${error}`);
    else change.defaultRule = rule;
  }
  if (values.changeMode) {
    if (values.scoringMode) change.scoringMode = values.scoringMode;
    else errors.push('计分模式：请选择计分模式');
  }
  for (const def of stages) {
    const mode = String(values[`stage_${def.key}`] ?? 'keep');
    let choice: StageChoice;
    if (mode === 'keep' || mode === 'clear') choice = { kind: mode };
    else if (mode === 'custom') {
      choice = customChoice(values[`stage_${def.key}_point`], values[`stage_${def.key}_cap`], values[`stage_${def.key}_games`]);
    } else choice = { kind: 'preset', scoringRule: mode };
    if (choice.kind === 'preset' || choice.kind === 'custom') {
      const error = ruleChoiceError(choice);
      if (error) {
        errors.push(`${def.label}：${error}`);
        continue;
      }
    }
    change.stages[def.key] = choice;
  }
  return { change, errors };
}

function stageRuleForView(event: ScoringEvent, key: string) {
  const rules = event.stageScoringRules;
  if (!rules) return undefined;
  return rules[key] ?? (key === 'QF' ? rules.BEFORE_TOP4 : undefined);
}

/**
 * 单项管理「批量改规则」：对勾选的单项一起改默认计分规则、计分模式和分阶段规则。
 * 逐个调用单个编辑的接口（PATCH /events/:id），只提交有变化的字段，其他设置不动。
 */
export default function BatchScoringModal<T extends ScoringEvent>({
  tournamentId,
  token,
  events,
  stages,
  stageKeysFor,
  labelOf,
  onClose,
  onSaved,
}: Props<T>) {
  const [form] = Form.useForm<FormValues>();
  const values = (Form.useWatch((all) => all, form) as FormValues | undefined) ?? EMPTY_VALUES;
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  // 各单项正在进行的场次数；null 表示还在读，'error' 表示没读到。
  const [liveCounts, setLiveCounts] = useState<Map<string, number> | null | 'error'>(null);

  useEffect(() => {
    if (!token || !tournamentId) return;
    let cancelled = false;
    apiFetch<{ matches: { eventId: string | null; status: string }[] }>(`/scheduling?tournamentId=${tournamentId}`, { token })
      .then((data) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const match of data.matches ?? []) {
          if (match.status === 'LIVE' && match.eventId) counts.set(match.eventId, (counts.get(match.eventId) ?? 0) + 1);
        }
        setLiveCounts(counts);
      })
      .catch(() => { if (!cancelled) setLiveCounts('error'); });
    return () => { cancelled = true; };
  }, [token, tournamentId]);

  // 只列出勾选的单项里至少有一个用得上的阶段（如「小组赛」只有带小组赛的赛制才有）。
  const ruleEvents = useMemo(() => events.filter((event) => !event.mixHostId), [events]);
  const visibleStages = useMemo(() => stages
    .map((def) => ({ ...def, applies: ruleEvents.filter((event) => stageKeysFor(event.format).includes(def.key)).length }))
    .filter((def) => def.applies > 0), [stages, ruleEvents, stageKeysFor]);

  const { change, errors } = useMemo(() => toChange(values, visibleStages), [values, visibleStages]);
  const plans = useMemo(() => planBatchScoring(events, change, stageKeysFor), [events, change, stageKeysFor]);
  const toSave = plans.filter((plan) => plan.status === 'change');
  const liveOf = (eventId: string) => (liveCounts instanceof Map ? liveCounts.get(eventId) ?? 0 : 0);
  const liveTotal = toSave.reduce((sum, plan) => sum + liveOf(plan.event.id), 0);
  const stageLabel = (key: string) => stages.find((def) => def.key === key)?.label ?? key;

  const save = async () => {
    if (errors.length || !toSave.length) return;
    if (liveTotal > 0) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `有 ${liveTotal} 场比赛正在进行`,
          content: '保存后这些比赛立刻按新规则计分，可能当局就会按新分数判定胜负。确定现在修改吗？',
          okText: '仍然修改',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    setSaving(true);
    const failed: string[] = [];
    let ok = 0;
    for (const plan of toSave) {
      try {
        await apiFetch(`/events/${plan.event.id}`, { method: 'PATCH', token, body: JSON.stringify(plan.patch) });
        ok += 1;
      } catch (error: unknown) {
        failed.push(`${labelOf(plan.event)}：${error instanceof Error ? error.message : '保存失败'}`);
      }
    }
    setSaving(false);
    await onSaved();
    if (failed.length) {
      setFailures(failed);
      message.warning(`已修改 ${ok} 个单项，${failed.length} 个没改成`);
      return;
    }
    message.success(`已修改 ${ok} 个单项的规则`);
    onClose();
  };

  const ruleLines = (event: T) => {
    const keys = stageKeysFor(event.format);
    const stageLines = stages
      .filter((def) => keys.includes(def.key))
      .map((def) => ({ def, rule: stageRuleForView(event, def.key) }))
      .filter((item) => item.rule && stageRuleSummary(item.rule) !== '同上级');
    return (
      <Space orientation="vertical" size={0}>
        <span>{defaultRuleSummary(event)} · {SCORING_MODE_LABELS[event.scoringMode] ?? event.scoringMode}</span>
        {stageLines.map(({ def, rule }) => (
          <Typography.Text key={def.key} type="secondary" style={{ fontSize: 12 }}>
            {def.label}：{stageRuleSummary(rule!)}
          </Typography.Text>
        ))}
      </Space>
    );
  };

  const columns = [
    { title: '单项', key: 'label', render: (_: unknown, plan: BatchPlan<T>) => labelOf(plan.event) },
    { title: '现在', key: 'before', render: (_: unknown, plan: BatchPlan<T>) => ruleLines(plan.event) },
    {
      title: '改后',
      key: 'after',
      render: (_: unknown, plan: BatchPlan<T>) => (plan.status === 'change' ? ruleLines(applyScoringPatch(plan.event, plan.patch)) : '—'),
    },
    {
      title: '说明',
      key: 'note',
      render: (_: unknown, plan: BatchPlan<T>) => (
        <Space orientation="vertical" size={2}>
          {plan.status === 'change' ? <Tag color="blue">将修改</Tag> : null}
          {plan.status === 'same' ? <Tag>无变化</Tag> : null}
          {plan.status === 'mix-member' ? (
            <>
              <Tag color="gold">跳过</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>已并入混编，按主项目的规则比赛，要改请改主项目</Typography.Text>
            </>
          ) : null}
          {plan.skippedStages.length ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              赛制没有{plan.skippedStages.map(stageLabel).join('、')}，这几项不改
            </Typography.Text>
          ) : null}
          {plan.status === 'change' && liveOf(plan.event.id) ? (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>正在进行 {liveOf(plan.event.id)} 场</Typography.Text>
          ) : null}
        </Space>
      ),
    },
  ];

  const stageOptions = [
    { value: 'keep', label: '不修改' },
    { value: 'clear', label: '清除（沿用上级规则）' },
    ...RULE_OPTIONS,
    { value: 'custom', label: '自定义局点' },
  ];

  return (
    <Modal
      title={`批量改规则（已选 ${events.length} 个单项）`}
      open
      onCancel={() => { if (!saving) onClose(); }}
      onOk={save}
      okText={toSave.length ? `修改 ${toSave.length} 个单项` : '修改'}
      cancelText="取消"
      okButtonProps={{ disabled: Boolean(errors.length) || !toSave.length }}
      cancelButtonProps={{ disabled: saving }}
      confirmLoading={saving}
      width={920}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title="只改勾了「修改」的部分；没勾的、阶段选「不修改」的，各单项保持原样。赛制、分组、名额、时长不受影响。"
        description={`计分规则在记分时实时读取：保存后这些单项所有没结束的比赛（包括正在打的）立刻按新规则计分，已结束的比赛成绩不变。${liveCounts === 'error' ? '（没读到正在进行的场次，请自行确认）' : ''}`}
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          changeDefault: false,
          defaultMethod: 'preset',
          defaultGames: 2,
          changeMode: false,
          ...Object.fromEntries(stages.flatMap((def) => [[`stage_${def.key}`, 'keep'], [`stage_${def.key}_games`, 2]])),
        }}
      >
        <Form.Item name="changeDefault" valuePropName="checked" style={{ marginBottom: 8 }}>
          <Checkbox>修改默认计分规则</Checkbox>
        </Form.Item>
        {values.changeDefault ? (
          <div style={{ paddingInlineStart: 24, marginBottom: 8 }}>
            <Form.Item name="defaultMethod" style={{ marginBottom: 8 }}>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 'preset', label: '使用预设规则' },
                  { value: 'custom', label: '自定义局点' },
                ]}
              />
            </Form.Item>
            {values.defaultMethod === 'custom' ? (
              <Space align="baseline" wrap>
                <Form.Item name="defaultPoint" style={{ marginBottom: 0 }}>
                  <InputNumber min={1} max={999} prefix="每局" suffix="分" style={{ width: 130 }} />
                </Form.Item>
                <Form.Item name="defaultCap" style={{ marginBottom: 0 }}>
                  <InputNumber min={1} max={999} prefix="封顶" placeholder="可选" style={{ width: 130 }} />
                </Form.Item>
                <Form.Item name="defaultGames" style={{ marginBottom: 0 }}>
                  <InputNumber min={1} max={9} prefix="赢" suffix="局" style={{ width: 110 }} />
                </Form.Item>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>胜出局数：1=单局，2=三局两胜，3=五局三胜</Typography.Text>
              </Space>
            ) : (
              <Form.Item name="defaultRule" style={{ marginBottom: 0 }}>
                <Select placeholder="选择计分规则" options={RULE_OPTIONS} style={{ width: 240 }} />
              </Form.Item>
            )}
          </div>
        ) : null}

        <Form.Item name="changeMode" valuePropName="checked" style={{ marginBottom: 8 }}>
          <Checkbox>修改计分模式</Checkbox>
        </Form.Item>
        {values.changeMode ? (
          <Form.Item name="scoringMode" style={{ paddingInlineStart: 24 }}>
            <Select
              placeholder="选择计分模式"
              options={Object.entries(SCORING_MODE_LABELS).map(([value, label]) => ({ value, label }))}
              style={{ width: 240 }}
            />
          </Form.Item>
        ) : null}

        <Divider plain style={{ margin: '8px 0 12px' }}>分阶段规则</Divider>
        {visibleStages.map((def) => (
          <Space key={def.key} align="baseline" wrap style={{ display: 'flex', marginBottom: 8 }}>
            <span style={{ display: 'inline-block', width: 72 }}>{def.label}</span>
            <Form.Item name={`stage_${def.key}`} style={{ marginBottom: 0 }}>
              <Select options={stageOptions} style={{ width: 200 }} />
            </Form.Item>
            {values[`stage_${def.key}`] === 'custom' ? (
              <>
                <Form.Item name={`stage_${def.key}_point`} style={{ marginBottom: 0 }}>
                  <InputNumber min={1} max={999} prefix="每局" suffix="分" style={{ width: 120 }} />
                </Form.Item>
                <Form.Item name={`stage_${def.key}_cap`} style={{ marginBottom: 0 }}>
                  <InputNumber min={1} max={999} prefix="封顶" placeholder="可选" style={{ width: 120 }} />
                </Form.Item>
                <Form.Item name={`stage_${def.key}_games`} style={{ marginBottom: 0 }}>
                  <InputNumber min={1} max={9} prefix="赢" suffix="局" style={{ width: 100 }} />
                </Form.Item>
              </>
            ) : null}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {def.description}
              {def.applies < ruleEvents.length ? `（只对其中 ${def.applies} 个单项生效）` : ''}
            </Typography.Text>
          </Space>
        ))}
      </Form>

      {errors.length ? (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} title="还有没填好的地方" description={errors.join('；')} />
      ) : null}
      {failures.length ? (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} title="以下单项没改成，其余已保存" description={failures.join('；')} />
      ) : null}

      <Divider plain style={{ margin: '8px 0 12px' }}>
        预览：{toSave.length} 个将修改{plans.length - toSave.length ? `，${plans.length - toSave.length} 个不变` : ''}
      </Divider>
      <Table
        size="small"
        rowKey={(plan) => plan.event.id}
        columns={columns}
        dataSource={plans}
        pagination={false}
        scroll={{ y: 320 }}
      />
    </Modal>
  );
}
