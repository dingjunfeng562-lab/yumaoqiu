'use client';

import { Button, Form, Input, InputNumber, Select, Space, Switch, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';

export const TEAM_EVENT_OPTIONS = [
  { value: 'MENS_SINGLES', label: '男单' }, { value: 'WOMENS_SINGLES', label: '女单' },
  { value: 'MENS_DOUBLES', label: '男双' }, { value: 'WOMENS_DOUBLES', label: '女双' },
  { value: 'MIXED_DOUBLES', label: '混双' },
];
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
export const teamDefaults = {
  maxPlayerAppearances: 2, playAllMatches: false, winThreshold: 3, isPublished: false,
  scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30',
  items: TEAM_EVENT_OPTIONS.map(item => ({ eventType: item.value })),
};

export default function TeamCompetitionFields() {
  const form = Form.useFormInstance();
  const items = Form.useWatch('items', form) ?? [];
  return <>
    <Form.Item name="name" label="团体赛名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="maxPlayerAppearances" label="兼项规则" rules={[{ required: true }]} extra="按同一场团体对阵计算，下一轮重新计算。每队人数不限，不限制男女人数；出场选手仍须符合各项目的性别要求。">
      <Select options={TEAM_APPEARANCE_OPTIONS} />
    </Form.Item>
    <Form.Item label="项目出场顺序" required extra="用上下箭头调整顺序；各子项的出场选手在对阵确定后手动填报。">
      <Form.List name="items" rules={[{ validator: async (_, value) => { if (!value?.length) throw new Error('至少选择一个项目'); } }]}>
        {(fields, { add, remove, move }, { errors }) => <Space orientation="vertical" style={{ width: '100%' }}>
          {fields.map((field, index) => <Space key={field.key} wrap>
            <Typography.Text>第 {index + 1} 项</Typography.Text>
            <Form.Item name={[field.name, 'eventType']} noStyle rules={[{ required: true }]}>
              <Select style={{ width: 130 }} options={TEAM_EVENT_OPTIONS} />
            </Form.Item>
            <Button aria-label={`上移第${index + 1}项`} icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, index - 1)} />
            <Button aria-label={`下移第${index + 1}项`} icon={<ArrowDownOutlined />} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)} />
            <Button aria-label={`移除第${index + 1}项`} icon={<DeleteOutlined />} disabled={fields.length === 1} onClick={() => remove(index)} />
          </Space>)}
          <Button icon={<PlusOutlined />} disabled={fields.length >= 5} onClick={() => add({})}>添加项目</Button>
          <Form.ErrorList errors={errors} />
        </Space>}
      </Form.List>
    </Form.Item>
    <Form.Item name="winThreshold" label="团体对阵先赢几项获胜" rules={[{ required: true }]} extra="先达到此胜场数的队伍获胜。">
      <InputNumber min={1} max={Math.ceil(items.length / 2) || 1} precision={0} />
    </Form.Item>
    <Form.Item name="playAllMatches" label="胜负确定后继续比赛" valuePropName="checked" extra="开启后继续打完剩余子项并记录完整比分，再推进下一轮；关闭时达到胜场数即结束，其余子项取消。">
      <Switch checkedChildren="继续比赛" unCheckedChildren="结束对阵" />
    </Form.Item>
    <Form.Item name="scoringRule" label="子项计分规则" rules={[{ required: true }]}><Select options={TEAM_SCORING_OPTIONS} /></Form.Item>
    <Form.Item name="scoringMode" label="平分规则" rules={[{ required: true }]}>
      <Select options={[{ value: 'CAPPED_30', label: '领先 2 分获胜，封顶分决胜' }, { value: 'STANDARD_GOLDEN', label: '到达目标分直接获胜（金球）' }]} />
    </Form.Item>
    <Space align="start" wrap>
      <Form.Item name="customGamePoint" label="自定义每局目标分" extra="留空使用上方预设"><InputNumber min={1} max={999} precision={0} /></Form.Item>
      <Form.Item name="customGameCap" label="自定义封顶分"><InputNumber min={1} max={999} precision={0} /></Form.Item>
      <Form.Item name="customGamesToWin" label="自定义先赢几局"><InputNumber min={1} max={9} precision={0} /></Form.Item>
    </Space>
    <Form.Item name="isPublished" label="公开展示" valuePropName="checked"><Switch /></Form.Item>
    <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
  </>;
}
