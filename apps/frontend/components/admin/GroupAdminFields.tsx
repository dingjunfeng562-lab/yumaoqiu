'use client';
import { Alert, Form, Input, Select, Typography } from 'antd';
import type { GroupFields } from '@/lib/registration-groups';

export function GroupAdminFields({ fields, doubles }: { fields: GroupFields; doubles: boolean }) {
  return <><Alert type="info" showIcon title="按当前组别的字段规则录入" description="身份证和性别可选填；缺少资格资料的选手会进入报名审核页，核验后才能进入签表。" style={{ marginBottom: 16 }} />
    {(doubles ? ['', 'partner'] : ['']).map(prefix => {
      const key = (name: string) => prefix ? prefix + name[0].toUpperCase() + name.slice(1) : name;
      return <div key={prefix}><Typography.Text strong>{prefix ? '搭档' : '本人'}</Typography.Text><div className="grid grid-cols-2 gap-x-3">
        <Form.Item name={key('name')} label="姓名" rules={[{ required: true, whitespace: true }]}><Input maxLength={50} /></Form.Item>
        <Form.Item name={key('contact')} label="联系方式" rules={[{ required: true, whitespace: true }]}><Input maxLength={50} /></Form.Item>
        <Form.Item name={key('school')} label="学校 / 单位" rules={prefix ? [] : [{ required: true, whitespace: true }]}><Input maxLength={191} placeholder={prefix ? '不填则与本人相同' : ''} /></Form.Item>
        {fields.gender !== 'hidden' && <Form.Item name={key('gender')} label="性别" rules={[{ required: fields.gender === 'required' }]}><Select allowClear options={[{ value: 'MALE', label: '男' }, { value: 'FEMALE', label: '女' }]} /></Form.Item>}
        {fields.identityNumber !== 'hidden' && <Form.Item name={key('identityNumber')} label="身份证号" rules={[{ required: fields.identityNumber === 'required', whitespace: true }]}><Input maxLength={18} autoComplete="off" /></Form.Item>}
        {(['studentId', 'college', 'majorGrade'] as const).filter(field => fields[field] !== 'hidden').map(field => <Form.Item key={field} name={key(field)} label={{ studentId: '学号', college: '学院', majorGrade: '年级专业' }[field]} rules={[{ required: fields[field] === 'required', whitespace: true }]}><Input maxLength={120} /></Form.Item>)}
      </div></div>;
    })}
    {doubles && <Form.Item name="teamName" label="组合名称（选填）"><Input maxLength={120} /></Form.Item>}
  </>;
}
