'use client';
import { useState } from 'react';
import { Button, Form, Input, Modal, Select, message } from 'antd';
import { apiFetch } from '@/lib/api';

export function TeamEligibilityButton({ teamId, player, token, onSaved }: { teamId: string; player: { id: string; name: string; gender?: string | null; eligibility?: { status?: string } | null }; token?: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  if (player.eligibility?.status !== 'PENDING') return null;
  return <><Button size="small" onClick={() => { form.resetFields(); form.setFieldsValue({ gender: player.gender }); setOpen(true); }}>资格待核验</Button>
    <Modal title={`${player.name} · 资格核验`} open={open} onCancel={() => setOpen(false)} confirmLoading={busy} onOk={async () => {
      try { const values = await form.validateFields(); setBusy(true); await apiFetch(`/team-competitions/teams/${teamId}/members/${player.id}/verify-eligibility`, { token, method: 'PATCH', body: JSON.stringify(values) }); setOpen(false); message.success('已记录核验结果'); await onSaved(); }
      catch (e) { if (e instanceof Error) message.error(e.message); } finally { setBusy(false); }
    }}><Form form={form} layout="vertical">
      <Form.Item name="gender" label="核验性别" rules={[{ required: true }]}><Select options={[{ value: 'MALE', label: '男' }, { value: 'FEMALE', label: '女' }]} /></Form.Item>
      <Form.Item name="note" label="年龄及性别核验依据" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} rows={4} placeholder="请线下核对组别年龄条件后记录依据，不要填写完整证件号码。" /></Form.Item>
    </Form></Modal></>;
}
