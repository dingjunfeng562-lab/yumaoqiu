'use client';

import { Modal, Typography } from 'antd';

/**
 * 后台批量导入：有标黄提醒的行（报名字段没填或有误、年龄不符），点「导入」时再确认一次。
 * lines 由 warningConfirmLines 生成；没有提醒时直接返回 true。
 */
export function confirmImportWarnings(count: number, lines: string[]): Promise<boolean> {
  if (!count) return Promise.resolve(true);
  return new Promise((resolve) => {
    Modal.confirm({
      title: `有 ${count} 条标黄提醒，确定照常导入吗？`,
      width: 600,
      content: (
        <div>
          <div style={{ maxHeight: 260, overflowY: 'auto', margin: '8px 0' }}>
            {lines.map((line) => (
              <div key={line}>
                <Typography.Text type="warning">{line}</Typography.Text>
              </div>
            ))}
          </div>
          <Typography.Text type="secondary">
            后台批量导入不强制报名字段：有误的身份证号不保存，年龄不符也照常导入；这些人的资格记为「未核验」，不用再逐条核验。
          </Typography.Text>
        </div>
      ),
      okText: '照常导入',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
