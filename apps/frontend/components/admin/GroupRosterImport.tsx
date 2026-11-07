'use client';
import { useState } from 'react';
import { Alert, Button, Modal, Select, Space, Table, Upload, message } from 'antd';
import { apiFetch } from '@/lib/api';
import { GROUP_EVENT_OPTIONS, identityPreview, type AgeRule, type GroupFields } from '@/lib/registration-groups';

type Row = Record<string, string> & { error: string; row: string };
const columns = { name: '姓名', gender: '性别', identityNumber: '身份证号', school: '学校/单位', contact: '联系方式', studentId: '学号', college: '学院', majorGrade: '年级专业', partnerName: '搭档姓名', partnerGender: '搭档性别', partnerIdentityNumber: '搭档身份证号', partnerContact: '搭档联系方式', partnerStudentId: '搭档学号', partnerCollege: '搭档学院', partnerMajorGrade: '搭档年级专业' };
export function GroupRosterImport({ tournamentId, group, token }: { tournamentId: string; group: { id: string; name: string; fieldTemplate: string; fieldRules: GroupFields; ageRule: AgeRule; events: Array<{ id: string; type: string }> }; token?: string }) {
  const [open, setOpen] = useState(false);
  const [eventId, setEventId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const event = group.events.find(e => e.id === eventId);
  const double = event?.type.endsWith('DOUBLES');
  async function template() {
    const XLSX = await import('xlsx');
    const keys = Object.keys(columns).filter(k => double || !k.startsWith('partner'));
    const sheet = XLSX.utils.aoa_to_sheet([keys.map(k => columns[k as keyof typeof columns])]);
    sheet['!cols'] = keys.map(() => ({ wch: 22 }));
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '报名模板');
    XLSX.writeFile(book, `${group.name}-报名模板.xlsx`);
  }
  async function read(file: File) {
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, defval: '' });
      if (grid.length > 501) throw new Error('每次最多导入500条，请拆分文件');
      const header = (grid[0] ?? []).map(v => String(v).trim());
      if (!['姓名', '学校/单位', '联系方式'].every(h => header.includes(h))) throw new Error('请使用本组报名模板，需包含姓名、学校/单位、联系方式列');
      const parsed = grid.slice(1).filter(row => row.some(v => v !== '')).map((cells, index) => {
        const data: Row = { row: String(index + 2), error: '' };
        const errors: string[] = [];
        for (const [key, label] of Object.entries(columns)) {
          const raw = cells[header.indexOf(label)];
          if (key.toLowerCase().includes('identity') && typeof raw === 'number') errors.push(`${label}必须按文本存储，请核对原号码，不能直接转换已损坏的数字`);
          data[key] = raw == null ? '' : String(raw).trim();
        }
        for (const [key, label] of [['name','姓名'],['school','学校/单位'],['contact','联系方式'], ...(double ? [['partnerName','搭档姓名'],['partnerContact','搭档联系方式']] : [])]) if (!data[key]) errors.push(`缺少${label}`);
        for (const prefix of double ? ['', 'partner'] : ['']) {
          const key = (field: string) => prefix ? prefix + field[0].toUpperCase() + field.slice(1) : field;
          for (const field of ['identityNumber','gender','studentId','college','majorGrade'] as const) {
            if (group.fieldRules[field] === 'hidden') { data[key(field)] = ''; continue; }
            if (!data[key(field)] && group.fieldRules[field] === 'required') errors.push(`缺少${columns[key(field) as keyof typeof columns]}`);
          }
          if (data[key('gender')]) {
            const g = data[key('gender')]; data[key('gender')] = g === '男' ? 'MALE' : g === '女' ? 'FEMALE' : g;
            if (!['MALE','FEMALE'].includes(data[key('gender')])) errors.push('性别请填写男或女');
          }
          const preview = identityPreview(data[key('identityNumber')], group.ageRule);
          if (preview.error) errors.push(`${prefix ? '搭档：' : ''}${preview.error}`);
        }
        data.error = errors.join('；'); return data;
      });
      setRows(parsed);
    } catch (e) { setRows([]); message.error(e instanceof Error ? e.message : '读取失败'); }
    return false;
  }
  return <><Button size="small" onClick={() => { setRows([]); setEventId(''); setOpen(true); }}>导入报名</Button><Modal title={`${group.name} · 导入报名`} open={open} onCancel={() => setOpen(false)} width={900} footer={null} destroyOnHidden>
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Alert showIcon type="info" title="一行填写一份单打或双打报名，双打搭档放在同一行" description="身份证和性别按组别配置收集。资料不足时导入为待审核；服务端仍会校验年龄和项目资格。身份证和联系电话请以文本格式保存。" />
      <Select style={{ width: '100%' }} value={eventId || undefined} placeholder="选择本组项目" onChange={v => { setEventId(v); setRows([]); }} options={group.events.map(e => ({ value: e.id, label: GROUP_EVENT_OPTIONS.find(o => o.value === e.type)?.label }))} />
      <Space><Button disabled={!eventId} onClick={() => void template()}>下载本项目模板</Button><Upload accept=".xlsx,.xls" beforeUpload={read} showUploadList={false} disabled={!eventId}><Button disabled={!eventId}>选择Excel文件</Button></Upload></Space>
      <Table rowKey="row" dataSource={rows} pagination={{ pageSize: 10 }} columns={[{ title: '行号', dataIndex: 'row' },{ title: '姓名', dataIndex: 'name' },{ title: '搭档', dataIndex: 'partnerName' },{ title: '联系方式', dataIndex: 'contact' },{ title: '检查结果', render: (_: unknown, r: Row) => r.error || '可提交，最终以服务端校验为准' }]} />
      <Button type="primary" loading={busy} disabled={!rows.length || rows.some(r => r.error)} onClick={async () => {
        setBusy(true);
        try { const result = await apiFetch<{ createdCount: number; pendingCount?: number }>(`/admin/competitions/${tournamentId}/players/batch`, { token, method: 'POST', body: JSON.stringify({ eventId, players: rows.map(p => ({ ...Object.fromEntries(Object.entries(p).filter(([key,v]) => key !== 'error' && key !== 'row' && v !== '')), row: Number(p.row), entrantType: group.fieldTemplate === 'SCHOOL' ? 'SCHOOL' : 'SOCIAL' })) }) });
          message.success(`已导入${result.createdCount}条，其中${result.pendingCount ?? 0}条待核验或审核`); setRows([]); setOpen(false);
        } catch (e) { message.error(e instanceof Error ? e.message : '导入失败，本批次未保存'); } finally { setBusy(false); }
      }}>确认导入 {rows.length} 条报名</Button>
    </Space>
  </Modal></>;
}
