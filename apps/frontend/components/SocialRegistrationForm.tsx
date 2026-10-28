'use client';

import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Select, Space, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';

export type SocialCodeInfo = {
  tournamentId: string;
  title: string;
  entrantType: 'SOCIAL';
  fieldRules?: {
    SOCIAL?: { email?: 'required' | 'optional' | 'hidden' };
  };
  events: Array<{ id: string; type: string; label: string; isDouble: boolean }>;
};

type ItemState = {
  eventId: string;
  partnerName: string;
  partnerGender: 'MALE' | 'FEMALE' | '';
  partnerContact: string;
};

const emptyItem: ItemState = { eventId: '', partnerName: '', partnerGender: '', partnerContact: '' };
const PHONE = /^\+?[\d-]{6,20}$/;

function genderError(type: string | undefined, gender: string, partnerGender?: string) {
  if (type === 'MENS_SINGLES' && gender !== 'MALE') return '男子单打性别必须为男';
  if (type === 'WOMENS_SINGLES' && gender !== 'FEMALE') return '女子单打性别必须为女';
  if (type === 'MENS_DOUBLES' && (gender !== 'MALE' || partnerGender !== 'MALE')) return '男子双打两人性别必须均为男';
  if (type === 'WOMENS_DOUBLES' && (gender !== 'FEMALE' || partnerGender !== 'FEMALE')) return '女子双打两人性别必须均为女';
  if (type === 'MIXED_DOUBLES' && (!partnerGender || gender === partnerGender)) return '混合双打必须一男一女';
  return '';
}

export default function SocialRegistrationForm({
  competitionId,
  registrationCode,
  info,
}: {
  competitionId: string;
  registrationCode: string;
  info: SocialCodeInfo;
}) {
  const [form] = Form.useForm();
  const [items, setItems] = useState<ItemState[]>([{ ...emptyItem }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ token: string } | null>(null);
  const emailRule = info.fieldRules?.SOCIAL?.email ?? 'optional';

  function updateItem(index: number, patch: Partial<ItemState>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addItem() {
    setItems((prev) => [...prev, { ...emptyItem }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(values: {
    name: string;
    gender: 'MALE' | 'FEMALE';
    unit: string;
    contact: string;
    email?: string;
  }) {
    setError('');
    if (!values.name?.trim() || !values.unit?.trim() || !values.contact?.trim()) {
      setError('请填写姓名、单位和联系方式');
      return;
    }
    if (!PHONE.test(values.contact.trim())) {
      setError('联系方式需为电话号码');
      return;
    }
    if (emailRule === 'required' && !values.email?.trim()) {
      setError('请填写邮箱');
      return;
    }
    if (!items.length || items.some((item) => !item.eventId)) {
      setError('请至少选择一个报名项目');
      return;
    }
    if (new Set(items.map((item) => item.eventId)).size !== items.length) {
      setError('报名项目不能重复');
      return;
    }
    for (const item of items) {
      const event = info.events.find((current) => current.id === item.eventId);
      if (!event) {
        setError('存在无效的报名项目');
        return;
      }
      if (event.isDouble) {
        if (!item.partnerName.trim() || !item.partnerGender || !item.partnerContact.trim()) {
          setError(`「${event.label}」需要填写搭档姓名、性别和联系方式`);
          return;
        }
        if (!PHONE.test(item.partnerContact.trim())) {
          setError('搭档联系方式需为电话号码');
          return;
        }
        const message = genderError(event.type, values.gender, item.partnerGender);
        if (message) {
          setError(`「${event.label}」${message}`);
          return;
        }
      } else {
        const message = genderError(event.type, values.gender);
        if (message) {
          setError(`「${event.label}」${message}`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<{
        message?: string;
        guestToken?: string | null;
        registration?: { id: string };
      }>(`/competitions/${competitionId}/public-register`, {
        method: 'POST',
        redirectOnForbidden: false,
        body: JSON.stringify({
          entrantType: 'SOCIAL',
          registrationCode,
          name: values.name.trim(),
          gender: values.gender,
          school: values.unit.trim(),
          contact: values.contact.trim(),
          guestEmail: emailRule === 'hidden' ? undefined : values.email?.trim() || undefined,
          items: items.map((item) => ({
            eventId: item.eventId,
            partnerName: item.partnerName.trim() || undefined,
            partnerGender: item.partnerGender || undefined,
            partnerContact: item.partnerContact.trim() || undefined,
          })),
        }),
      });
      if (!result.guestToken) {
        setError('报名已提交，但未返回查询编号，请联系组委会。');
        return;
      }
      setSuccess({ token: result.guestToken });
      message.success(result.message ?? '报名已提交');
    } catch (err) {
      setError(err instanceof Error ? err.message : '报名提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <Card title="报名已提交">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="success"
            showIcon
            message="社会组报名已提交，请等待组委会审核"
            description="请保存下面的报名编号，凭编号和链接查询审核状态。"
          />
          <div>
            <Typography.Text type="secondary">报名编号</Typography.Text>
            <Typography.Title level={4} copyable style={{ margin: '4px 0 0' }}>
              {success.token}
            </Typography.Title>
          </div>
          <Button type="primary" href={`/competitions/${competitionId}/registration-status?token=${encodeURIComponent(success.token)}`}>
            查看报名状态
          </Button>
        </Space>
      </Card>
    );
  }

  return (
    <Card title="社会组报名" extra={<Typography.Text type="secondary">{info.title}</Typography.Text>}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="社会组无需登录，提交后凭报名编号查询审核结果"
        description="单位/俱乐部可填写“个人”；双打需填写搭档姓名、性别和联系方式。"
      />
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ gender: 'MALE' }}>
        <div className="grid gap-4 md:grid-cols-2">
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请填写姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="gender" label="性别" rules={[{ required: true }]}>
            <Select options={[{ value: 'MALE', label: '男' }, { value: 'FEMALE', label: '女' }]} />
          </Form.Item>
          <Form.Item name="unit" label="单位/俱乐部" rules={[{ required: true, message: '请填写单位' }]}>
            <Input placeholder="例如：飞羽俱乐部 / 个人" />
          </Form.Item>
          <Form.Item
            name="contact"
            label="联系方式"
            rules={[{ required: true, message: '请填写联系方式' }, { pattern: PHONE, message: '请输入电话号码' }]}
          >
            <Input />
          </Form.Item>
          {emailRule !== 'hidden' ? (
            <Form.Item
              name="email"
              label={emailRule === 'required' ? '邮箱' : '邮箱（选填）'}
              rules={emailRule === 'required' ? [{ required: true, message: '请填写邮箱' }] : []}
            >
              <Input placeholder="用于接收审核结果，可不填" />
            </Form.Item>
          ) : null}
        </div>

        <Typography.Title level={5}>报名项目</Typography.Title>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {items.map((item, index) => {
            const event = info.events.find((current) => current.id === item.eventId);
            return (
              <Card key={`${index}-${item.eventId}`} size="small">
                <div className="grid gap-4 md:grid-cols-2">
                  <Form.Item label={`项目 ${index + 1}`} required style={{ marginBottom: 0 }}>
                    <Select
                      value={item.eventId || undefined}
                      placeholder="请选择项目"
                      onChange={(value) => updateItem(index, { eventId: value, partnerName: '', partnerGender: '', partnerContact: '' })}
                      options={info.events.map((option) => ({
                        value: option.id,
                        label: option.label,
                        disabled: items.some((current, i) => i !== index && current.eventId === option.id),
                      }))}
                    />
                  </Form.Item>
                  {event?.isDouble ? (
                    <>
                      <Form.Item label="搭档姓名" required style={{ marginBottom: 0 }}>
                        <Input value={item.partnerName} onChange={(e) => updateItem(index, { partnerName: e.target.value })} />
                      </Form.Item>
                      <Form.Item label="搭档性别" required style={{ marginBottom: 0 }}>
                        <Select
                          value={item.partnerGender || undefined}
                          onChange={(value) => updateItem(index, { partnerGender: value })}
                          options={[
                            { value: 'MALE', label: '男' },
                            { value: 'FEMALE', label: '女' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item label="搭档联系方式" required style={{ marginBottom: 0 }}>
                        <Input value={item.partnerContact} onChange={(e) => updateItem(index, { partnerContact: e.target.value })} />
                      </Form.Item>
                    </>
                  ) : (
                    <Typography.Text type="secondary">单打项目仅需本人信息</Typography.Text>
                  )}
                </div>
                {items.length > 1 ? (
                  <Button danger type="link" onClick={() => removeItem(index)} style={{ marginTop: 8 }}>
                    删除这个项目
                  </Button>
                ) : null}
              </Card>
            );
          })}
          <Button type="dashed" onClick={addItem} disabled={items.length >= 5}>
            新增项目
          </Button>
        </Space>

        <Button
          type="primary"
          htmlType="submit"
          size="large"
          loading={submitting}
          style={{ marginTop: 20, width: '100%' }}
        >
          提交社会组报名
        </Button>
      </Form>
    </Card>
  );
}
