'use client';
import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';

type Application = { id: string; name: string; gender?: string | null; eligibility?: { status?: string } | null; identity?: { masked?: string; birthDate?: string } | null; items: Array<{ id: string; eventName: string; partnerName?: string | null; partnerGender?: string | null; eligibility?: { status?: string } | null }> };
export function EligibilityReviewButton({ registration, token, onSaved }: { registration: Application; token?: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  if (!registration.items.some(i => i.eligibility?.status === 'PENDING')) return null;
  const options = [{ value: 'MALE', label: '男' }, { value: 'FEMALE', label: '女' }];
  return <><Button size="small" onClick={() => { form.resetFields(); form.setFieldsValue({ gender: registration.gender, partnerGenders: Object.fromEntries(registration.items.map(i => [i.id, i.partnerGender])) }); setOpen(true); }}>资格核验</Button>
    <Modal title={`${registration.name} · 资格核验`} open={open} onCancel={() => setOpen(false)} confirmLoading={busy} onOk={async () => {
      try { const values = await form.validateFields(); setBusy(true); await apiFetch(`/admin/competition-registrations/${registration.id}/verify-eligibility`, { token, method: 'PATCH', body: JSON.stringify(values) }); message.success('资格核验已记录，可以审核报名'); setOpen(false); await onSaved(); }
      catch (e) { if (e instanceof Error) message.error(e.message); } finally { setBusy(false); }
    }}>
      <Alert type="info" showIcon title="请核对实际参赛资格后填写" description="身份证为选填时，可线下核验年龄，不要求补录完整号码。核验完成后仍需通过报名审核。" style={{ marginBottom: 16 }} />
      {registration.identity && <Typography.Paragraph>证件：{registration.identity.masked} · 出生日期：{registration.identity.birthDate}</Typography.Paragraph>}
      <Form form={form} layout="vertical"><Form.Item name="gender" label="本人性别（核验结果）" rules={[{ required: true }]}><Select options={options} /></Form.Item>
        {registration.items.filter(i => i.partnerName).map(i => <Form.Item key={i.id} name={['partnerGenders', i.id]} label={`${i.eventName} · ${i.partnerName}性别`} rules={[{ required: true }]}><Select options={options} /></Form.Item>)}
        <Form.Item name="note" label="年龄及性别核验依据" rules={[{ required: true, whitespace: true, message: '请记录核验依据' }]}><Input.TextArea maxLength={500} rows={4} placeholder="例如：已线下查验本人及搭档证件，出生日期符合本组规则。请勿在此填写完整身份证号。" /></Form.Item>
      </Form>
    </Modal>
  </>;
}
