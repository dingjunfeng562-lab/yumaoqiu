'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Modal, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { QrcodeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiFetch } from '@/lib/api';
import { GROUP_EVENT_OPTIONS, GROUP_FIELD_OPTIONS, type AgeRule, type GroupFields } from '@/lib/registration-groups';
import { GroupRosterImport } from '@/components/admin/GroupRosterImport';
import { RegistrationQrModal, qrUsability, type RegistrationQrTarget } from '@/components/admin/RegistrationQrModal';
import {
  GroupConfigFields,
  groupPayload,
  groupToFormValues,
  isStudentGroup,
  newGroupValues,
  type GroupFormValues,
} from '@/components/admin/GroupConfigFields';

export type RegistrationGroup = {
  id: string;
  legacyType?: string | null;
  name: string;
  categoryLabel?: string | null;
  fieldTemplate: string;
  enabled: boolean;
  registrationCodeEnabled: boolean;
  registrationCode?: string | null;
  fieldRules: GroupFields;
  ageRule: AgeRule;
  ageRuleLabel: string;
  events: Array<{ id: string; type: string }>;
  payment?: { enabled: boolean; singlesFee: number; doublesFee: number; teamFee: number; instructions?: string | null } | null;
  _count: { applications: number };
};

export type GroupsTournamentMeta = {
  name: string;
  startDate?: string;
  isArchived?: boolean;
  isPublished?: boolean;
  approvalStatus?: string;
  registrationCode?: string | null;
  registrationCodeEnabled?: boolean;
};

/**
 * 「组别设置」页：组别列表 + 新增/编辑/删除 + 导入报名，顶部是赛事报名码。
 * 一个赛事一个报名码，报名人扫码后自己选组别，各组别不再单独有码。
 */
export function RegistrationGroupsManager({
  tournamentId,
  token,
  tournament,
}: {
  tournamentId: string;
  token?: string;
  tournament?: GroupsTournamentMeta | null;
}) {
  const [groups, setGroups] = useState<RegistrationGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RegistrationGroup | null | undefined>(undefined);
  // 弹窗关闭即销毁表单（destroyOnHidden + preserve={false}），打开前 setFieldsValue 会丢值，
  // 所以默认值通过 initialValues 在表单挂载时写入。
  const [formValues, setFormValues] = useState<GroupFormValues>();
  const [qr, setQr] = useState<RegistrationQrTarget | null>(null);
  const [form] = Form.useForm<GroupFormValues>();
  const base = `/admin/competitions/${tournamentId}/groups`;
  const refDate = tournament?.startDate ? dayjs(tournament.startDate).format('YYYY-MM-DD') : undefined;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setGroups(await apiFetch<RegistrationGroup[]>(base, { token }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      setLoading(false);
    }
  }, [base, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function open(group: RegistrationGroup | null) {
    setFormValues(group ? groupToFormValues(group, refDate) : newGroupValues(refDate));
    setEditing(group);
  }

  async function save() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await apiFetch(`${base}${editing ? `/${editing.id}` : ''}`, {
        token,
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(groupPayload(values)),
      });
      message.success('组别已保存');
      setEditing(undefined);
      await load();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(group: RegistrationGroup) {
    try {
      await apiFetch(`${base}/${group.id}`, { token, method: 'DELETE' });
      message.success(`已删除「${group.name}」`);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  function openQr() {
    if (!tournament?.registrationCode) return;
    setQr({
      tournamentId,
      tournamentName: tournament.name,
      code: tournament.registrationCode,
      ...qrUsability({
        archived: tournament.isArchived,
        published: tournament.isPublished === undefined ? undefined : tournament.isPublished && tournament.approvalStatus === 'APPROVED',
        groupOpen: groups.some((group) => group.enabled && group.events.length > 0),
        codeEnabled: tournament.registrationCodeEnabled !== false,
      }),
    });
  }

  // 没开学生组时，空的默认学生组不显示。
  const visible = groups.filter((group) => !group.legacyType || group.events.length > 0);
  const fieldLabel = (value: string) => GROUP_FIELD_OPTIONS.find((option) => option.value === value)?.label ?? '';

  return (
    <div className="space-y-3">
      <Space wrap>
        <Button type="primary" onClick={() => open(null)}>新增组别</Button>
        {tournament ? (
          tournament.registrationCode ? (
            <Space size={6}>
              <Typography.Text type="secondary">赛事报名码</Typography.Text>
              <Typography.Text code copyable={{ text: tournament.registrationCode }}>{tournament.registrationCode}</Typography.Text>
              {tournament.registrationCodeEnabled === false ? <Tag>已停用</Tag> : null}
              <Button size="small" icon={<QrcodeOutlined />} onClick={openQr}>二维码</Button>
            </Space>
          ) : (
            <Typography.Text type="secondary">还没有赛事报名码，请在赛事管理列表的「报名码」列生成。</Typography.Text>
          )
        ) : null}
      </Space>
      {error ? <Alert type="error" title={error} /> : null}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={visible}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: '还没有组别，点「新增组别」添加' }}
        columns={[
          {
            title: '组别',
            dataIndex: 'name',
            render: (name: string, group: RegistrationGroup) => (
              <>
                <strong>{name}</strong>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {isStudentGroup({ legacy: Boolean(group.legacyType), fieldRules: group.fieldRules }) ? '学生' : '第三方'}
                  {group.categoryLabel ? ` · ${group.categoryLabel}` : ''}
                </div>
              </>
            ),
          },
          { title: '年龄要求', dataIndex: 'ageRuleLabel' },
          {
            title: '比赛项目',
            render: (_: unknown, group: RegistrationGroup) =>
              group.events.map((event) => GROUP_EVENT_OPTIONS.find((option) => option.value === event.type)?.label).join('、'),
          },
          {
            title: '身份证 / 性别',
            render: (_: unknown, group: RegistrationGroup) => `${fieldLabel(group.fieldRules.identityNumber)} / ${fieldLabel(group.fieldRules.gender)}`,
          },
          {
            title: '报名',
            render: (_: unknown, group: RegistrationGroup) => (
              <Tag color={group.enabled ? 'green' : 'default'}>{group.enabled ? '开放中' : '已关闭'}</Tag>
            ),
          },
          {
            title: '操作',
            render: (_: unknown, group: RegistrationGroup) => (
              <Space wrap>
                <Button size="small" onClick={() => open(group)}>编辑</Button>
                <GroupRosterImport tournamentId={tournamentId} group={group} token={token} />
                <Popconfirm
                  title={`删除「${group.name}」？`}
                  description="已有报名或比赛数据的组别不能删除，可以关闭本组报名。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove(group)}
                >
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑 ${editing.name}` : '新增组别'}
        open={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        onOk={() => void save()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={formValues}>
          <GroupConfigFields form={form} refDate={refDate} />
        </Form>
      </Modal>

      <RegistrationQrModal target={qr} onClose={() => setQr(null)} />
    </div>
  );
}
