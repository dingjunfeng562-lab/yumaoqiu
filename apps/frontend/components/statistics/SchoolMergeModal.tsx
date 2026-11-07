'use client';

// 超级管理员整理学校名称：疑似重复一键归并、手动归并 / 标记无效、撤销已有归并。
// 归并结果全局生效（所有赛事的统计都按它识别学校）。

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AutoComplete, Button, Divider, Empty, Modal, Popconfirm, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';

export type MergeSuggestion = { name: string; people: number; candidates: string[] };

type SchoolAlias = { id: string; alias: string; canonical: string | null; ignored: boolean; updatedBy: string | null; updatedAt: string };

// 带边框的简单列表（antd 6 已弃用 List）：左边内容、右边操作。
function Rows({ children, maxHeight }: { children: ReactNode; maxHeight?: number }) {
  return (
    <div style={{ border: '1px solid rgba(5, 5, 5, 0.1)', borderRadius: 8, maxHeight, overflowY: maxHeight ? 'auto' : undefined }}>
      {children}
    </div>
  );
}

function Row({ children, actions, last }: { children: ReactNode; actions: ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 12px',
        borderBottom: last ? 'none' : '1px solid rgba(5, 5, 5, 0.06)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>{children}</div>
      <Space size={4}>{actions}</Space>
    </div>
  );
}

export function SchoolMergeModal({ open, onClose, token, schoolNames, ignoredNames, suggestions, onChanged }: {
  open: boolean;
  onClose: () => void;
  token?: string;
  /** 当前赛事里出现的标准校名（含人数），用作归并来源和目标的选项。 */
  schoolNames: Array<{ name: string; people: number }>;
  ignoredNames: string[];
  suggestions: MergeSuggestion[];
  onChanged: () => void;
}) {
  const [aliases, setAliases] = useState<SchoolAlias[]>([]);
  const [loadingAliases, setLoadingAliases] = useState(false);
  const [busy, setBusy] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState('');

  const loadAliases = useCallback(async () => {
    if (!token) return;
    setLoadingAliases(true);
    try {
      setAliases(await apiFetch<SchoolAlias[]>('/admin/statistics/school-aliases', { token, cache: 'no-store' }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取归并记录失败');
    } finally {
      setLoadingAliases(false);
    }
  }, [token]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.resolve().then(() => (cancelled ? undefined : loadAliases()));
    return () => {
      cancelled = true;
    };
  }, [open, loadAliases]);

  const save = async (key: string, body: { names: string[]; canonical?: string; ignored?: boolean }, done: string) => {
    if (!token) return;
    setBusy(key);
    try {
      setAliases(await apiFetch<SchoolAlias[]>('/admin/statistics/school-aliases', { method: 'PUT', token, body: JSON.stringify(body) }));
      message.success(done);
      onChanged();
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
      return false;
    } finally {
      setBusy('');
    }
  };

  const remove = async (alias: SchoolAlias) => {
    if (!token) return;
    setBusy(`delete:${alias.id}`);
    try {
      await apiFetch(`/admin/statistics/school-aliases/${alias.id}`, { method: 'DELETE', token });
      setAliases((current) => current.filter((item) => item.id !== alias.id));
      message.success('已撤销');
      onChanged();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '撤销失败');
    } finally {
      setBusy('');
    }
  };

  const nameOptions = [...schoolNames.map((item) => ({ value: item.name, label: `${item.name}（${item.people} 人）` })),
    ...ignoredNames.map((name) => ({ value: name, label: `${name}（已标记无效）` }))];

  return (
    <Modal
      title="整理学校名称"
      open={open}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        报名时学校是手填的，同一所学校可能有多种写法。归并后按标准校名统计人数和高校数；标记为无效的写法不计入高校数。
        归并对所有赛事生效，可随时撤销。
      </Typography.Paragraph>

      <Typography.Title level={5} style={{ marginTop: 0 }}>疑似重复</Typography.Title>
      {suggestions.length ? (
        <Rows>
          {suggestions.map((item, index) => {
            const choice = picked[item.name] ?? item.candidates[0];
            return (
              <Row
                key={item.name}
                last={index === suggestions.length - 1}
                actions={(
                  <>
                    <Button
                      type="primary"
                      size="small"
                      loading={busy === `merge:${item.name}`}
                      onClick={() => save(`merge:${item.name}`, { names: [item.name], canonical: choice }, `已把「${item.name}」归并到「${choice}」`)}
                    >
                      归并
                    </Button>
                    <Button
                      size="small"
                      loading={busy === `ignore:${item.name}`}
                      onClick={() => save(`ignore:${item.name}`, { names: [item.name], ignored: true }, `已把「${item.name}」标记为无效`)}
                    >
                      标为无效
                    </Button>
                  </>
                )}
              >
                <Space wrap size={6}>
                  <Typography.Text strong>{item.name}</Typography.Text>
                  <Typography.Text type="secondary">{item.people} 人</Typography.Text>
                  <span>→</span>
                  <Select
                    size="small"
                    style={{ minWidth: 220 }}
                    value={choice}
                    onChange={(value) => setPicked((current) => ({ ...current, [item.name]: value }))}
                    options={item.candidates.map((candidate) => ({ value: candidate, label: candidate }))}
                  />
                </Space>
              </Row>
            );
          })}
        </Rows>
      ) : (
        <Typography.Text type="secondary">没有发现疑似重复的写法。</Typography.Text>
      )}

      <Divider />
      <Typography.Title level={5} style={{ marginTop: 0 }}>手动归并</Typography.Title>
      <Space orientation="vertical" style={{ width: '100%' }} size={8}>
        <Select
          mode="multiple"
          allowClear
          placeholder="选择要归并或标记无效的写法（可多选）"
          style={{ width: '100%' }}
          value={sources}
          onChange={setSources}
          options={nameOptions}
          optionFilterProp="label"
        />
        <Space.Compact style={{ width: '100%' }}>
          <AutoComplete
            style={{ flex: 1 }}
            placeholder="标准校名（可从列表选，也可以直接输入）"
            value={target}
            onChange={setTarget}
            options={schoolNames.filter((item) => !sources.includes(item.name)).map((item) => ({ value: item.name }))}
            filterOption={(input, option) => String(option?.value ?? '').includes(input.trim())}
          />
          <Button
            type="primary"
            disabled={!sources.length || !target.trim()}
            loading={busy === 'manual-merge'}
            onClick={async () => {
              if (await save('manual-merge', { names: sources, canonical: target.trim() }, `已归并到「${target.trim()}」`)) {
                setSources([]);
                setTarget('');
              }
            }}
          >
            归并
          </Button>
          <Button
            disabled={!sources.length}
            loading={busy === 'manual-ignore'}
            onClick={async () => {
              if (await save('manual-ignore', { names: sources, ignored: true }, '已标记为无效')) setSources([]);
            }}
          >
            标为无效
          </Button>
        </Space.Compact>
      </Space>

      <Divider />
      <Typography.Title level={5} style={{ marginTop: 0 }}>已有归并记录</Typography.Title>
      <Spin spinning={loadingAliases}>
        {aliases.length ? (
          <Rows maxHeight={260}>
            {aliases.map((alias, index) => (
              <Row
                key={alias.id}
                last={index === aliases.length - 1}
                actions={(
                  <Popconfirm title="撤销这条归并？" okText="撤销" cancelText="取消" onConfirm={() => remove(alias)}>
                    <Button size="small" type="link" loading={busy === `delete:${alias.id}`}>撤销</Button>
                  </Popconfirm>
                )}
              >
                <Space wrap size={6}>
                  <Typography.Text>{alias.alias}</Typography.Text>
                  <span>→</span>
                  {alias.ignored ? <Tag>无效，不计入</Tag> : <Typography.Text strong>{alias.canonical}</Typography.Text>}
                  {alias.updatedBy ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{alias.updatedBy}</Typography.Text> : null}
                </Space>
              </Row>
            ))}
          </Rows>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无归并记录" />
        )}
      </Spin>
    </Modal>
  );
}
