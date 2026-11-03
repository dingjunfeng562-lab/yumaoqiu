'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Form, Input, Modal, Segmented, Select, Spin, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { apiFetch } from '@/lib/api';

type FieldState = 'required' | 'optional' | 'hidden';
type EntrantType = 'SCHOOL' | 'SOCIAL';

export type EditableFieldRules = {
  SCHOOL: { studentId: FieldState; college: FieldState; majorGrade: FieldState };
};

export type EditableEvent = {
  id: string;
  type: string;
  label: string;
  isDouble: boolean;
  entrantType?: EntrantType;
};

export type RedrawEvent = { id: string; label: string };

export type RegistrationSaveResult = {
  redrawEvents?: RedrawEvent[];
  movedEvents?: string[];
  /** 一起转到学生组、但搭档还缺学号或学院的双打项目 */
  incompleteEvents?: string[];
};

type Detail = {
  id: string;
  eventId: string;
  entrantType: EntrantType;
  primaryName?: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  studentId: string;
  school: string;
  college: string;
  majorGrade: string;
  className: string;
  phone: string;
  teamName: string | null;
  partner: {
    name: string;
    gender: 'MALE' | 'FEMALE';
    studentId: string;
    school: string;
    college: string;
    majorGrade: string;
    className: string;
    phone: string;
  } | null;
  otherEvents: Array<{ id: string; eventId: string; eventType: string; label: string }>;
};

type FormValues = {
  entrantType: EntrantType;
  eventId: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  studentId?: string;
  school: string;
  college?: string;
  majorGrade?: string;
  contact: string;
  teamName?: string;
  partnerName?: string;
  partnerGender?: 'MALE' | 'FEMALE';
  partnerStudentId?: string;
  partnerSchool?: string;
  partnerCollege?: string;
  partnerMajorGrade?: string;
  partnerContact?: string;
};

const DEFAULT_RULES: EditableFieldRules = {
  SCHOOL: { studentId: 'required', college: 'required', majorGrade: 'optional' },
};

const GENDER_OPTIONS = [
  { value: 'MALE', label: '男' },
  { value: 'FEMALE', label: '女' },
];

const GROUP_LABELS: Record<EntrantType, string> = { SCHOOL: '学生组', SOCIAL: '社会组' };

const grid = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 12, marginTop: 8 } as const;

/** 截止时间过了没有：过了只能删除，不能再改报名信息和组别。 */
export function isEditDeadlinePassed(deadline?: string | null) {
  return Boolean(deadline && dayjs().isAfter(dayjs(deadline)));
}

/**
 * 修改单项报名（参赛选手页与缴费管理共用，后端规则一致）：
 * - 可以改组别、参赛项目和选手信息；
 * - 改组别时，同一份线上报名的其他项目会一起转到另一组的同名项目；
 * - 已抽签的项目改完需要重新抽签，结果里的 redrawEvents 交给调用方提示。
 * 表单只读写报名信息，不包含缴费情况。
 */
export function RegistrationEditModal({
  open,
  registrationId,
  basePath,
  token,
  events,
  fieldRules,
  editDeadline,
  onClose,
  onSaved,
}: {
  open: boolean;
  registrationId?: string | null;
  /** 读取和保存的接口前缀，后面拼报名 ID，例如 /admin/competitions/{赛事}/players */
  basePath: string;
  token?: string;
  events: EditableEvent[];
  fieldRules?: Partial<EditableFieldRules> | null;
  editDeadline?: string | null;
  onClose: () => void;
  onSaved: (result: RegistrationSaveResult) => void | Promise<void>;
}) {
  const [form] = Form.useForm<FormValues>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const rules = { SCHOOL: { ...DEFAULT_RULES.SCHOOL, ...(fieldRules?.SCHOOL ?? {}) } };
  const locked = isEditDeadlinePassed(editDeadline);

  const watchedGroup = Form.useWatch('entrantType', form);
  const watchedEventId = Form.useWatch('eventId', form);
  const group: EntrantType = watchedGroup ?? detail?.entrantType ?? 'SCHOOL';
  const isSchool = group === 'SCHOOL';
  const groupEvents = useMemo(
    () => events.filter((event) => (event.entrantType ?? 'SCHOOL') === group),
    [events, group],
  );
  const availableGroups = useMemo(
    () => (['SCHOOL', 'SOCIAL'] as EntrantType[]).filter((type) => events.some((event) => (event.entrantType ?? 'SCHOOL') === type)),
    [events],
  );
  const selectedEvent = events.find((event) => event.id === watchedEventId);
  const isDouble = Boolean(selectedEvent?.isDouble);
  const groupChanged = Boolean(detail && group !== detail.entrantType);

  useEffect(() => {
    if (!open || !registrationId || !token) return;
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (!alive) return null;
        setLoading(true);
        setDetail(null);
        form.resetFields();
        return apiFetch<Detail>(`${basePath}/${registrationId}`, { token });
      })
      .then((data) => {
        if (!data) return;
        if (!alive) return;
        setDetail(data);
        form.setFieldsValue({
          entrantType: data.entrantType,
          eventId: data.eventId,
          name: data.primaryName || data.name,
          gender: data.gender,
          studentId: data.studentId || undefined,
          school: data.school,
          college: data.college || undefined,
          majorGrade: data.majorGrade || undefined,
          contact: data.phone,
          teamName: data.teamName ?? undefined,
          partnerName: data.partner?.name,
          partnerGender: data.partner?.gender,
          partnerStudentId: data.partner?.studentId || undefined,
          partnerSchool: data.partner?.school || undefined,
          partnerCollege: data.partner?.college || undefined,
          partnerMajorGrade: data.partner?.majorGrade || undefined,
          partnerContact: data.partner?.phone || undefined,
        });
      })
      .catch((error) => {
        if (!alive) return;
        message.error(error instanceof Error ? error.message : '报名信息加载失败');
        onClose();
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // onClose 由调用方每次渲染重新创建，不作为重新加载的依据。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, registrationId, token, basePath, form]);

  function changeGroup(next: EntrantType) {
    // 换组别时默认选另一组的同名项目，没有同名项目就让管理员重新选。
    const current = events.find((event) => event.id === form.getFieldValue('eventId'));
    const sameType = events.find((event) => (event.entrantType ?? 'SCHOOL') === next && event.type === current?.type);
    form.setFieldsValue({ entrantType: next, eventId: sameType?.id });
  }

  function fieldRule(state: FieldState, label: string) {
    return state === 'required' ? [{ required: true, message: `请填写${label}` }] : [];
  }

  async function submit() {
    if (!token || !registrationId || !detail) return;
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const school = values.entrantType === 'SCHOOL';
    const trim = (value?: string) => value?.trim() || undefined;
    const payload: Record<string, string | undefined> = {
      entrantType: values.entrantType,
      eventId: values.eventId,
      name: values.name.trim(),
      gender: values.gender,
      school: values.school.trim(),
      contact: values.contact.trim(),
      studentId: school ? trim(values.studentId) : undefined,
      college: school ? trim(values.college) : undefined,
      majorGrade: school ? trim(values.majorGrade) : undefined,
    };
    if (isDouble) {
      Object.assign(payload, {
        teamName: trim(values.teamName),
        partnerName: trim(values.partnerName),
        partnerGender: values.partnerGender,
        partnerContact: trim(values.partnerContact),
        // 搭档学校/单位、学院、年级专业不填时，后端按队员一的填写。
        partnerSchool: trim(values.partnerSchool),
        partnerStudentId: school ? trim(values.partnerStudentId) : undefined,
        partnerCollege: school ? trim(values.partnerCollege) : undefined,
        partnerMajorGrade: school ? trim(values.partnerMajorGrade) : undefined,
      });
    }

    const save = async () => {
      setSaving(true);
      try {
        const result = await apiFetch<RegistrationSaveResult>(`${basePath}/${registrationId}`, {
          method: 'PATCH',
          token,
          body: JSON.stringify(payload),
        });
        const moved = result.movedEvents?.length ? `，${result.movedEvents.join('、')}已一起转组` : '';
        message.success(`已保存报名信息${moved}`);
        if (result.incompleteEvents?.length) {
          message.warning(`${result.incompleteEvents.join('、')}的搭档还没有学号或学院，请在列表里编辑该项目补填`, 8);
        }
        await onSaved(result);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '保存失败');
      } finally {
        setSaving(false);
      }
    };

    if (groupChanged) {
      const others = detail.otherEvents;
      Modal.confirm({
        title: `改为${GROUP_LABELS[values.entrantType]}？`,
        content: (
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {others.length
              ? `该选手在本赛事还报名了 ${others.map((item) => item.label).join('、')}，将一起转到${GROUP_LABELS[values.entrantType]}的同名项目。`
              : `将转到${GROUP_LABELS[values.entrantType]}。`}
            缴费状态和已缴金额保持不变，如两组收费不同，请在缴费管理中核对差额。
            {values.entrantType === 'SOCIAL' ? '社会组不保留学号、学院和年级专业。' : ''}
            {values.entrantType === 'SCHOOL' && others.some((item) => events.find((event) => event.type === item.eventType)?.isDouble)
              ? '一起转过去的双打项目，搭档的学号、学院请转组后再编辑该项目补填。'
              : ''}
          </Typography.Paragraph>
        ),
        okText: '确认转组',
        cancelText: '取消',
        onOk: save,
      });
      return;
    }
    await save();
  }

  return (
    <Modal
      title="编辑报名信息"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="保存"
      cancelText={locked ? '关闭' : '取消'}
      okButtonProps={{ disabled: locked || loading || !detail }}
      confirmLoading={saving}
      width={isDouble ? 720 : 520}
      forceRender
    >
      <Spin spinning={loading}>
        {locked ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title={`已过报名信息修改截止时间（${dayjs(editDeadline).format('YYYY-MM-DD HH:mm')}），只能查看，不能修改。`}
            description="如需修改，请先在缴费管理中调整截止时间。"
          />
        ) : null}
        <Form form={form} layout="vertical" disabled={locked}>
          {availableGroups.length > 1 ? (
            <Form.Item label="组别" name="entrantType" rules={[{ required: true }]}>
              <Segmented
                options={availableGroups.map((type) => ({ value: type, label: GROUP_LABELS[type] }))}
                onChange={(value) => changeGroup(value as EntrantType)}
              />
            </Form.Item>
          ) : (
            <Form.Item name="entrantType" hidden><Input /></Form.Item>
          )}
          {groupChanged && detail?.otherEvents.length ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              title={`改组别时，${detail.otherEvents.map((item) => item.label).join('、')}也会一起转到${GROUP_LABELS[group]}。`}
            />
          ) : null}
          <Form.Item label="参赛项目" name="eventId" rules={[{ required: true, message: '请选择参赛项目' }]}>
            <Select
              options={groupEvents.map((event) => ({ value: event.id, label: event.label }))}
              placeholder={groupEvents.length ? '选择参赛项目' : `${GROUP_LABELS[group]}暂无项目`}
            />
          </Form.Item>

          <Typography.Text strong>{isDouble ? '队员一' : '选手信息'}</Typography.Text>
          <div style={grid}>
            <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请填写姓名' }]}>
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item label="性别" name="gender" rules={[{ required: true, message: '请选择性别' }]}>
              <Select options={GENDER_OPTIONS} />
            </Form.Item>
            <Form.Item label="联系方式" name="contact" rules={[{ required: true, message: '请填写联系方式' }]}>
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item
              label={isSchool ? '学校' : '单位'}
              name="school"
              rules={[{ required: true, message: isSchool ? '请填写学校' : '请填写单位' }]}
            >
              <Input maxLength={191} />
            </Form.Item>
            {isSchool && rules.SCHOOL.studentId !== 'hidden' ? (
              <Form.Item label="学号" name="studentId" rules={fieldRule(rules.SCHOOL.studentId, '学号')}>
                <Input maxLength={50} />
              </Form.Item>
            ) : null}
            {isSchool && rules.SCHOOL.college !== 'hidden' ? (
              <Form.Item label="学院" name="college" rules={fieldRule(rules.SCHOOL.college, '学院')}>
                <Input maxLength={120} />
              </Form.Item>
            ) : null}
            {isSchool && rules.SCHOOL.majorGrade !== 'hidden' ? (
              <Form.Item label="年级专业" name="majorGrade" rules={fieldRule(rules.SCHOOL.majorGrade, '年级专业')}>
                <Input maxLength={120} />
              </Form.Item>
            ) : null}
          </div>

          {isDouble ? (
            <>
              <Form.Item label="组合名称（选填）" name="teamName">
                <Input maxLength={120} />
              </Form.Item>
              <Typography.Text strong>队员二（搭档）</Typography.Text>
              <div style={grid}>
                <Form.Item label="搭档姓名" name="partnerName" rules={[{ required: true, message: '请填写搭档姓名' }]}>
                  <Input maxLength={50} />
                </Form.Item>
                <Form.Item label="搭档性别" name="partnerGender" rules={[{ required: true, message: '请选择搭档性别' }]}>
                  <Select options={GENDER_OPTIONS} />
                </Form.Item>
                <Form.Item label="搭档联系方式" name="partnerContact" rules={[{ required: true, message: '请填写搭档联系方式' }]}>
                  <Input maxLength={50} />
                </Form.Item>
                <Form.Item label={isSchool ? '搭档学校' : '搭档单位'} name="partnerSchool" extra="不填则与队员一相同">
                  <Input maxLength={191} />
                </Form.Item>
                {isSchool && rules.SCHOOL.studentId !== 'hidden' ? (
                  <Form.Item label="搭档学号" name="partnerStudentId" rules={fieldRule(rules.SCHOOL.studentId, '搭档学号')}>
                    <Input maxLength={50} />
                  </Form.Item>
                ) : null}
                {isSchool && rules.SCHOOL.college !== 'hidden' ? (
                  <Form.Item label="搭档学院" name="partnerCollege" extra="不填则与队员一相同">
                    <Input maxLength={120} />
                  </Form.Item>
                ) : null}
                {isSchool && rules.SCHOOL.majorGrade !== 'hidden' ? (
                  <Form.Item label="搭档年级专业" name="partnerMajorGrade" extra="不填则与队员一相同">
                    <Input maxLength={120} />
                  </Form.Item>
                ) : null}
              </div>
            </>
          ) : null}
        </Form>
      </Spin>
    </Modal>
  );
}

/** 删除或调整报名后，提示哪些项目要重新抽签、哪些团体赛要重新编排。 */
export function showRedrawPrompt(result: {
  redrawEvents?: RedrawEvent[];
  redrawTeamCompetitions?: Array<{ id: string; name: string }>;
}) {
  const events = result.redrawEvents ?? [];
  const teams = result.redrawTeamCompetitions ?? [];
  if (!events.length && !teams.length) return;
  Modal.warning({
    title: '请重新抽签编排',
    width: 520,
    okText: '知道了',
    content: (
      <div>
        {events.length ? (
          <Typography.Paragraph>
            以下项目已经抽过签，参赛名单有变动（删除或调入调出），签表需要重新生成：{events.map((event) => event.label).join('、')}。
            请到 <a href="/nicaiyixiahh/draws">抽签编排</a> 重新抽签，重新抽签前不能冻结或发布签表；如设置了种子，请一并核对。
          </Typography.Paragraph>
        ) : null}
        {teams.length ? (
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            以下团体赛原有对阵尚未发布，已自动清空：
            {teams.map((team, index) => (
              <span key={team.id}>
                {index ? '、' : ''}
                <a href={`/nicaiyixiahh/team-competitions/${team.id}`}>{team.name}</a>
              </span>
            ))}
            。请进入团体赛重新生成对阵。
          </Typography.Paragraph>
        ) : null}
      </div>
    ),
  });
}
