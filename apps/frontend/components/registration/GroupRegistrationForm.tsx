'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Select, Space, Tag, Typography, type FormInstance } from 'antd';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { ageForRule, birthFromIdentity, cnDate, identityPreview, type RegistrationGroupInfo } from '@/lib/registration-groups';

type Person = { name: string; gender?: string; identityNumber?: string; contact: string; school?: string; studentId?: string; college?: string; majorGrade?: string; age?: number | null; shirtSize?: string };
type Values = Person & { guestEmail?: string; partners?: Record<string, Person> };
/** 一个赛事一个报名码：扫码后先选组别，再填该组的报名表。 */
export function GroupPicker({ groups, onPick }: {
  groups: Array<{ groupId: string; groupName: string; ageRuleLabel: string; events: Array<{ id: string; label: string }>; remaining?: number | null }>;
  onPick: (groupId: string) => void;
}) {
  return <Card title="选择报名组别">
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      {groups.map((group) => {
        // 组别人数满了也能点进去：已报名的选手还可以追加项目，新的人提交时会被拦下。
        const full = group.remaining === 0;
        return (
          <Card key={group.groupId} size="small" hoverable onClick={() => onPick(group.groupId)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong style={{ fontSize: 16 }}>{group.groupName}</Typography.Text>
                {full ? <Tag color="red" style={{ marginInlineStart: 8 }}>名额已满</Tag> : null}
                {group.remaining != null && !full ? <Tag color="blue" style={{ marginInlineStart: 8 }}>剩 {group.remaining} 个名额</Tag> : null}
                <div><Typography.Text type="secondary">{group.ageRuleLabel}</Typography.Text></div>
                <div><Typography.Text type="secondary">项目：{group.events.map((event) => event.label.replace(`${group.groupName} · `, '')).join('、')}</Typography.Text></div>
                {full ? <div><Typography.Text type="danger">本组报名人数已满，已报名的选手仍可追加项目</Typography.Text></div> : null}
              </div>
              <Button type={full ? 'default' : 'primary'}>{full ? '追加项目' : '报名'}</Button>
            </div>
          </Card>
        );
      })}
    </Space>
  </Card>;
}

/** 项目后面的名额提示：没设上限时不显示。 */
function capacityText(event: { isDouble: boolean; remaining?: number | null }) {
  if (event.remaining == null) return '';
  return event.remaining === 0 ? '（已满）' : `（剩 ${event.remaining} ${event.isDouble ? '队' : '人'}）`;
}

export default function GroupRegistrationForm({ info, registrationCode, onBack }: { info: RegistrationGroupInfo; registrationCode: string; onBack?: () => void }) {
  const { data: session } = useSession();
  const [form] = Form.useForm<Values>();
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ guestToken?: string | null; registration: { status: string }; message: string } | null>(null);
  const fields = info.groupFields;
  const maxEvents = info.maxRegistrationEvents ?? 2;
  const ownIdentity = Form.useWatch('identityNumber', form) ?? '';
  const partnerValues = Form.useWatch('partners', form) as Values['partners'];

  // 年龄口径说明：按出生年份 / 以某日计周岁。
  const ageBasis = info.ageRule.ageInput
    ? info.ageRule.ageInput.basis === 'YEAR'
      ? `按出生年份计算：${info.ageRule.ageInput.refDate.slice(0, 4)} − 出生年份`
      : `以${cnDate(info.ageRule.ageInput.refDate)}为准的周岁`
    : info.ageRule.mode === 'AGE' && info.ageRule.cutoffDate ? `以${cnDate(info.ageRule.cutoffDate)}为准的周岁` : '周岁';

  const personFields = (eventId?: string) => {
    const path = (key: string) => eventId ? ['partners', eventId, key] : [key];
    const number = eventId ? partnerValues?.[eventId]?.identityNumber ?? '' : ownIdentity;
    const preview = identityPreview(number, info.ageRule);
    // 填了合法身份证号就按身份证自动算年龄，年龄框锁定。
    const birth = fields.identityNumber === 'hidden' ? null : birthFromIdentity(number);
    const syncAge = (value: string) => {
      const date = birthFromIdentity(value);
      // 搭档字段在 partners.{eventId} 下，路径是动态的，用宽松的表单类型赋值。
      if (date && fields.age !== 'hidden') (form as FormInstance).setFieldValue(path('age'), ageForRule(info.ageRule, date));
    };
    const optional = (key: keyof typeof fields) => fields[key] === 'optional' ? '（选填）' : '';
    return <div className="grid gap-x-4 md:grid-cols-2">
      <Form.Item name={path('name')} label={eventId ? '搭档姓名' : '姓名'} rules={[{ required: true, whitespace: true, message: '请填写姓名' }]}><Input maxLength={80} /></Form.Item>
      {fields.gender !== 'hidden' && <Form.Item name={path('gender')} label={`性别${optional('gender')}`} rules={[{ required: fields.gender === 'required', message: '请选择性别' }]}><Select allowClear placeholder="请选择" options={[{ value: 'MALE', label: '男' }, { value: 'FEMALE', label: '女' }]} /></Form.Item>}
      {!eventId && <Form.Item name="school" label={info.fieldTemplate === 'SCHOOL' ? '学校' : '单位'} rules={[{ required: true, whitespace: true, message: info.fieldTemplate === 'SCHOOL' ? '请填写学校' : '请填写单位，可填个人' }]}><Input placeholder={info.fieldTemplate === 'SCHOOL' ? '学校名称' : '学校、单位或俱乐部，可填个人'} maxLength={120} /></Form.Item>}
      {fields.age !== 'hidden' && <Form.Item name={path('age')} label={`年龄${optional('age')}`}
        rules={[{ validator: (_, value?: number | null) => (fields.age === 'required' && value == null && !birth ? Promise.reject(new Error('请填写年龄，或填写身份证号自动计算')) : Promise.resolve()) }]}
        extra={birth ? '已按身份证号自动计算' : `${ageBasis}；填写身份证号会自动计算`}>
        <InputNumber min={0} max={150} precision={0} disabled={Boolean(birth)} suffix="岁" style={{ width: '100%' }} />
      </Form.Item>}
      <Form.Item name={path('contact')} label="联系方式" rules={[{ required: true, message: '请填写联系方式' }, { pattern: /^\+?[\d\s()-]{6,24}$/, message: '请输入联系电话' }]}><Input placeholder="可填写监护人联系电话" maxLength={24} /></Form.Item>
      {fields.identityNumber !== 'hidden' && <Form.Item name={path('identityNumber')} label={`身份证号${optional('identityNumber')}`} rules={[{ required: fields.identityNumber === 'required', message: '请填写身份证号' }, { validator: (_, value) => { const check = identityPreview(value ?? '', info.ageRule); return check.error ? Promise.reject(new Error(check.error)) : Promise.resolve(); } }]} extra={preview.text || '用于计算年龄和资格核验，不在公开名单展示'}><Input maxLength={18} autoComplete="off" spellCheck={false} onChange={(event) => syncAge(event.target.value)} /></Form.Item>}
      {(['studentId', 'college', 'majorGrade'] as const).map((key) => fields[key] !== 'hidden' && <Form.Item key={key} name={path(key)} label={`${({ studentId: '学号', college: '学院', majorGrade: '年级专业' })[key]}${optional(key)}`} rules={[{ required: fields[key] === 'required', whitespace: true, message: '请填写此项' }]}><Input maxLength={120} /></Form.Item>)}
      {fields.shirtSize !== 'hidden' && <Form.Item name={path('shirtSize')} label={`衣服尺寸${optional('shirtSize')}`} rules={[{ required: fields.shirtSize === 'required', whitespace: true, message: '请填写衣服尺寸' }]}><Input maxLength={32} placeholder="例如 M、XL、130、170/88A" /></Form.Item>}
    </div>;
  };

  async function submit(values: Values) {
    if (!events.length) { setError('请至少选择一个项目'); return; }
    setBusy(true); setError('');
    try {
      const token = session?.user?.accessToken;
      const response = await apiFetch<NonNullable<typeof result>>(`/competitions/${info.tournamentId}/${token ? 'register' : 'public-register'}`, {
        method: 'POST', token, redirectOnForbidden: false,
        body: JSON.stringify({ ...values, partners: undefined, age: values.age ?? undefined, shirtSize: values.shirtSize?.trim() || undefined, groupId: info.groupId, registrationCode,
          entrantType: info.fieldTemplate === 'SCHOOL' ? 'SCHOOL' : 'SOCIAL',
          items: events.map(eventId => { const p = values.partners?.[eventId]; return { eventId,
            partnerName: p?.name, partnerGender: p?.gender, partnerIdentityNumber: p?.identityNumber,
            partnerContact: p?.contact, partnerStudentId: p?.studentId, partnerCollege: p?.college, partnerMajorGrade: p?.majorGrade,
            partnerAge: p?.age ?? undefined, partnerShirtSize: p?.shirtSize?.trim() || undefined,
          }; }),
        }),
      });
      setResult(response); form.resetFields();
    } catch (e) { setError(e instanceof Error ? e.message : '提交失败'); }
    finally { setBusy(false); }
  }

  if (result) return <Card title="报名已提交"><Space orientation="vertical" size="large" style={{ width: '100%' }}>
    <Alert type="success" showIcon title={result.message} description={result.registration.status === 'pending' ? '年龄或性别资料待核验时，组委会将在审核中核实参赛资格。' : '报名已通过；如本组需要缴费，请查看缴费信息。'} />
    {result.guestToken ? <><Typography.Text>请保存报名编号</Typography.Text><Typography.Text copyable strong>{result.guestToken}</Typography.Text><Link href={`/competitions/${info.tournamentId}/registration-status?token=${encodeURIComponent(result.guestToken)}`}>查看报名状态</Link><Link href={`/competitions/${info.tournamentId}/payment?token=${encodeURIComponent(result.guestToken)}`}>查看缴费信息</Link></> : <Link href="/my-registrations">查看我的报名</Link>}
  </Space></Card>;

  return <Card title={`${info.groupName} · 报名`} extra={onBack ? <Button type="link" onClick={onBack} style={{ padding: 0 }}>重新选择组别</Button> : null}>
    <Alert type="info" showIcon title={info.ageRuleLabel} description="填写身份证号会自动计算年龄；缺少资格资料可先提交，由组委会核验。监护人可以代为报名。" style={{ marginBottom: 20 }} />
    {info.remaining === 0 && <Alert type="warning" showIcon title={`本组报名人数已满（${info.maxEntrants} 人）`} description="新报名无法提交；已经报名的选手可以继续追加项目（填写与第一次报名相同的姓名和联系方式）。" style={{ marginBottom: 16 }} />}
    {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
    <Form form={form} layout="vertical" onFinish={submit}>
      <Form.Item label={`参赛项目（最多${maxEvents}项）`} required><Checkbox.Group value={events} onChange={values => setEvents(values as string[])} options={info.events.map(e => ({ value: e.id, label: `${e.label}${capacityText(e)}`, disabled: !events.includes(e.id) && (events.length >= maxEvents || e.remaining === 0) }))} /></Form.Item>
      {personFields()}
      {fields.email !== 'hidden' && <Form.Item name="guestEmail" label={`邮箱${fields.email === 'optional' ? '（选填）' : ''}`} rules={[{ required: fields.email === 'required' }, { type: 'email', message: '邮箱格式有误' }]}><Input type="email" /></Form.Item>}
      {info.events.filter(e => events.includes(e.id) && e.isDouble).map(event => <Card key={event.id} size="small" title={`${event.label} · 搭档资料`} style={{ marginBottom: 16 }}>{personFields(event.id)}</Card>)}
      <Button type="primary" htmlType="submit" size="large" block loading={busy} disabled={info.registrationOpen === false}>提交报名</Button>
    </Form>
  </Card>;
}
