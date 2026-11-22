'use client';

import { Alert, Button, Divider, Form, Input, InputNumber, Select, Space, Switch, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { TEAM_STAGE_DEFS, teamStagePayload, type TeamStageFormValues } from '@/lib/team-stage-scoring';
import { isTeamGroupKnockout, TEAM_GROUP_KNOCKOUT_2023, TEAM_GROUP_KNOCKOUT_2023_LABEL } from '@/lib/team-competition-format';

export const TEAM_EVENT_OPTIONS = [
  { value: 'MENS_SINGLES', label: '男单' }, { value: 'WOMENS_SINGLES', label: '女单' },
  { value: 'MENS_DOUBLES', label: '男双' }, { value: 'WOMENS_DOUBLES', label: '女双' },
  { value: 'MIXED_DOUBLES', label: '混双' },
];
/** 团体赛每场最多的出场项目数，同一项目可以重复。与后端 TEAM_ITEM_MAX 保持一致。 */
export const TEAM_ITEM_MAX = 7;
export const TEAM_SCORING_OPTIONS = [
  { value: 'FIFTEEN_ONE', label: '15 分 1 局' }, { value: 'FIFTEEN_BO3', label: '15 分 3 局 2 胜' },
  { value: 'TWENTYONE_BO3', label: '21 分 3 局 2 胜' }, { value: 'THIRTYONE_BO3', label: '31 分 3 局 2 胜' },
];
export const TEAM_APPEARANCE_OPTIONS = [
  { value: 1, label: '不允许兼项' },
  { value: 2, label: '最多兼两项' },
  { value: 0, label: '兼项不限' },
];
export const teamAppearanceLabel = (limit: number) => TEAM_APPEARANCE_OPTIONS.find(option => option.value === limit)?.label ?? '最多兼两项';
export const TEAM_FORMAT_OPTIONS = [
  { value: 'GROUP_ROUND_ROBIN', label: '小组赛' },
  { value: 'GROUP_PLUS_KNOCKOUT', label: '小组赛 + 淘汰赛' },
  { value: TEAM_GROUP_KNOCKOUT_2023, label: TEAM_GROUP_KNOCKOUT_2023_LABEL },
  { value: 'SINGLE_ELIMINATION', label: '单淘汰赛（兼容）' },
  { value: 'ROUND_ROBIN', label: '小组赛（单组循环）' },
];
export const teamFormatLabel = (format?: string) => TEAM_FORMAT_OPTIONS.find(option => option.value === format)?.label ?? '单淘汰赛（兼容）';
export const TEAM_THIRD_PLACE_OPTIONS = [
  { value: 'BY_RECORD', label: '不打季军赛，按成绩排第三、四名' },
  { value: 'SHARED', label: '不打季军赛，两队并列第三' },
  { value: 'PLAYOFF', label: '加赛季军赛' },
];
const hasKnockout = (format?: string) => format === 'SINGLE_ELIMINATION' || isTeamGroupKnockout(format);
export const teamFormatPayload = (values: { format?: string; groupCount?: number; advancePerGroup?: number; thirdPlaceMode?: string; stageForm?: TeamStageFormValues }) => ({
  format: values.format ?? 'SINGLE_ELIMINATION',
  groupCount: values.format === 'SINGLE_ELIMINATION' ? null : values.format === 'ROUND_ROBIN' ? 1 : values.groupCount ?? 1,
  advancePerGroup: isTeamGroupKnockout(values.format) ? values.advancePerGroup ?? 2 : null,
  thirdPlaceMode: values.thirdPlaceMode ?? 'BY_RECORD',
  // 分阶段计分只在「小组赛 + 淘汰赛」赛制下有效，其它赛制提交 null 清空
  stageScoringRules: isTeamGroupKnockout(values.format) ? teamStagePayload(values.stageForm) : null,
  // 表单内部字段，不提交（JSON.stringify 会去掉 undefined）
  stageForm: undefined,
});
export const teamDefaults = {
  maxPlayerAppearances: 2, playAllMatches: false, winThreshold: 3, isPublished: false,
  scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30',
  format: 'GROUP_ROUND_ROBIN', groupCount: 1, advancePerGroup: 2, thirdPlaceMode: 'BY_RECORD',
  items: TEAM_EVENT_OPTIONS.map(item => ({ eventType: item.value })),
};

/** 封顶分不能小于每局分数（留空不检查）；与后端的校验一致，保存前就提示。 */
const capRule = (pointPath: string | (string | number)[]) => ({ getFieldValue }: { getFieldValue: (name: string | (string | number)[]) => unknown }) => ({
  validator: async (_: unknown, cap?: number | null) => {
    const point = getFieldValue(pointPath) as number | null | undefined;
    if (cap && point && cap < point) throw new Error('封顶分不能小于每局分数');
  },
});

/**
 * formatLocked：赛制、小组数、晋级数不能改。
 * rulesLocked：已生成对阵，赛制、兼项、项目、胜场和计分规则都不能改（后端也会拦）；
 * 仍可改的是「胜负确定后继续比赛」、第三名、公开展示和说明。
 */
export default function TeamCompetitionFields({ formatLocked = false, rulesLocked = false }: { formatLocked?: boolean; rulesLocked?: boolean }) {
  const form = Form.useFormInstance();
  const items = Form.useWatch('items', form) ?? [];
  const format = Form.useWatch('format', form);
  const stageForm: TeamStageFormValues | undefined = Form.useWatch('stageForm', form);
  const lockFormat = formatLocked || rulesLocked;
  return <>
    {rulesLocked && <Alert showIcon type="warning" style={{ marginBottom: 16 }} title="已生成对阵：赛制、兼项、出场项目、胜场和计分规则不能再改"
      description="如需修改，请先在详情页右上角「取消对阵」，改完再重新生成对阵。「胜负确定后继续比赛」、第三名、公开展示和说明仍可修改。" />}
    {/* 团体赛不单独起名：挂在组别下，名称自动取「组别名团体赛」，组别改名时一起改。 */}
    <Form.Item name="format" label="赛制" rules={[{ required: true }]}><Select disabled={lockFormat} options={TEAM_FORMAT_OPTIONS} onChange={value => { if (value === 'ROUND_ROBIN') form.setFieldsValue({ groupCount: 1, advancePerGroup: null }); }} /></Form.Item>
    {format === 'ROUND_ROBIN' && <Alert showIcon type="info" style={{ marginBottom: 16 }} title="全部团体同组，每两队交手一次" description="全部对阵打完即结束比赛，依次比较胜场、胜次、净胜分，再比较两队相互胜负。胜次为正式子项获胜数；净胜分为正式子项每局得分减失分的合计，补打不计入。6 队共 5 轮、15 场团体对阵，每轮最多使用 3 片场地。" />}
    {format !== 'SINGLE_ELIMINATION' && <Form.Item name="groupCount" label="小组数量" rules={[{ required: format !== 'ROUND_ROBIN', message: '请填写小组数量' }]} extra={format === 'ROUND_ROBIN' ? '单组循环固定为 1 组。' : '填 1 为单组循环，填 2 或以上为多组循环；每组至少 2 支队伍。'}>
      <InputNumber disabled={lockFormat || format === 'ROUND_ROBIN'} min={1} precision={0} />
    </Form.Item>}
    {isTeamGroupKnockout(format) && <Form.Item name="advancePerGroup" label="每组晋级队数" rules={[{ required: true, message: '请填写晋级队数' }]} extra="晋级队数不能超过最小小组队数，总晋级队数至少为 2。淘汰赛中小组第一优先轮空，同组队伍尽量分在不同半区、晚相遇。">
      <InputNumber disabled={lockFormat} min={1} precision={0} />
    </Form.Item>}
    {hasKnockout(format) && <Form.Item name="thirdPlaceMode" label="第三名" extra="加赛季军赛时，两场半决赛的负者再打一场团体对阵决出三、四名；须 4 队及以上进入淘汰赛。淘汰赛对阵生成后不能再增加或取消季军赛，另外两项随时可改。">
      <Select options={TEAM_THIRD_PLACE_OPTIONS} />
    </Form.Item>}
    <Form.Item name="maxPlayerAppearances" label="兼项规则" rules={[{ required: true }]} extra="按同一场团体对阵计算，下一轮重新计算。每队人数不限，不限制男女人数；出场选手仍须符合各项目的性别要求。">
      <Select disabled={rulesLocked} options={TEAM_APPEARANCE_OPTIONS} />
    </Form.Item>
    <Form.Item label="项目出场顺序" required extra={`最多 ${TEAM_ITEM_MAX} 项，同一项目可以重复（如三单两双）；用上下箭头调整顺序；各子项的出场选手在对阵确定后手动填报。`}>
      <Form.List name="items" rules={[{ validator: async (_, value) => { if (!value?.length) throw new Error('至少选择一个项目'); } }]}>
        {(fields, { add, remove, move }, { errors }) => <Space orientation="vertical" style={{ width: '100%' }}>
          {fields.map((field, index) => <Space key={field.key} wrap>
            <Typography.Text>第 {index + 1} 项</Typography.Text>
            <Form.Item name={[field.name, 'eventType']} noStyle rules={[{ required: true }]}>
              <Select disabled={rulesLocked} style={{ width: 130 }} options={TEAM_EVENT_OPTIONS} />
            </Form.Item>
            <Button aria-label={`上移第${index + 1}项`} icon={<ArrowUpOutlined />} disabled={rulesLocked || index === 0} onClick={() => move(index, index - 1)} />
            <Button aria-label={`下移第${index + 1}项`} icon={<ArrowDownOutlined />} disabled={rulesLocked || index === fields.length - 1} onClick={() => move(index, index + 1)} />
            <Button aria-label={`移除第${index + 1}项`} icon={<DeleteOutlined />} disabled={rulesLocked || fields.length === 1} onClick={() => remove(index)} />
          </Space>)}
          <Button icon={<PlusOutlined />} disabled={rulesLocked || fields.length >= TEAM_ITEM_MAX} onClick={() => add({})}>添加项目</Button>
          <Form.ErrorList errors={errors} />
        </Space>}
      </Form.List>
    </Form.Item>
    <Form.Item name="winThreshold" label="团体对阵先赢几项获胜" rules={[{ required: true }]} extra="先达到此胜场数的队伍获胜。">
      <InputNumber disabled={rulesLocked} min={1} max={Math.ceil(items.length / 2) || 1} precision={0} />
    </Form.Item>
    <Form.Item name="playAllMatches" label="胜负确定后继续比赛" valuePropName="checked" extra="开启后打完剩余子项并保留比分；正式比分、胜次和净胜分只统计到先赢够场数时，补打不影响排名。关闭时其余子项无需比赛。抽签后开启可恢复尚未开赛的剩余子项（已生成淘汰赛时不恢复）。">
      <Switch checkedChildren="继续比赛" unCheckedChildren="结束对阵" />
    </Form.Item>
    <Form.Item name="scoringRule" label="子项计分规则" rules={[{ required: true }]}><Select disabled={rulesLocked} options={TEAM_SCORING_OPTIONS} /></Form.Item>
    <Form.Item name="scoringMode" label="平分规则" rules={[{ required: true }]}>
      <Select disabled={rulesLocked} options={[{ value: 'CAPPED_30', label: '领先 2 分获胜，封顶分决胜' }, { value: 'STANDARD_GOLDEN', label: '到达目标分直接获胜（金球）' }]} />
    </Form.Item>
    <Space align="start" wrap>
      <Form.Item name="customGamePoint" label="自定义每局目标分" extra="留空使用上方预设"><InputNumber disabled={rulesLocked} min={1} max={999} precision={0} /></Form.Item>
      <Form.Item name="customGameCap" label="自定义封顶分" dependencies={['customGamePoint']} rules={[capRule('customGamePoint')]}><InputNumber disabled={rulesLocked} min={1} max={999} precision={0} /></Form.Item>
      <Form.Item name="customGamesToWin" label="自定义先赢几局"><InputNumber disabled={rulesLocked} min={1} max={9} precision={0} /></Form.Item>
    </Space>
    {isTeamGroupKnockout(format) && <>
      <Divider plain style={{ margin: '8px 0 12px' }}>分阶段计分（可选）</Divider>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        小组赛、淘汰赛的子项可以分别设置，例如小组赛 21 分 1 局、淘汰赛 15 分 3 局 2 胜；未设置的阶段用上面的子项计分规则，平分规则两个阶段相同。已生成对阵后不能再修改。
      </Typography.Paragraph>
      {TEAM_STAGE_DEFS.map(def => <div key={def.key}>
        <Form.Item name={['stageForm', def.key, 'mode']} label={`${def.label}（${def.description}）`} initialValue="default" style={{ marginBottom: 8 }}>
          <Select disabled={rulesLocked} options={[{ value: 'default', label: '同上面的子项计分规则' }, ...TEAM_SCORING_OPTIONS, { value: 'custom', label: '自定义分数和局数' }]} />
        </Form.Item>
        {stageForm?.[def.key]?.mode === 'custom' && <Space align="baseline" wrap style={{ marginBottom: 8 }}>
          <Form.Item name={['stageForm', def.key, 'point']} rules={[{ required: true, message: '请填写每局分数' }]} style={{ marginBottom: 0 }}>
            <InputNumber disabled={rulesLocked} aria-label={`${def.label}每局分数`} min={1} max={999} precision={0} placeholder="每局分数" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name={['stageForm', def.key, 'cap']} dependencies={[['stageForm', def.key, 'point']]} rules={[capRule(['stageForm', def.key, 'point'])]} style={{ marginBottom: 0 }}>
            <InputNumber disabled={rulesLocked} aria-label={`${def.label}封顶分`} min={1} max={999} precision={0} placeholder="封顶分（可选）" style={{ width: 130 }} />
          </Form.Item>
          <Form.Item name={['stageForm', def.key, 'games']} initialValue={1} rules={[{ required: true, message: '请填写先赢几局' }]} style={{ marginBottom: 0 }}>
            <InputNumber disabled={rulesLocked} aria-label={`${def.label}先赢几局`} min={1} max={9} precision={0} placeholder="先赢几局" style={{ width: 120 }} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>先赢几局：1 = 一局定胜负，2 = 三局两胜</Typography.Text>
        </Space>}
      </div>)}
    </>}
    <Form.Item name="isPublished" label="公开展示" valuePropName="checked"><Switch /></Form.Item>
    <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
  </>;
}
