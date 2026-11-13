// 缴费管理的排序和名单导出单测：cd apps/frontend && pnpm test（需要 Node 23.6+，可以直接 import .ts）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSettled, isUnpaidDue, paymentListSheet, paymentSortRank, sortPaymentRows } from './payments.ts';

const row = (id, overrides = {}) => ({
  id,
  groupId: 'g1',
  entrantType: 'SOCIAL',
  itemId: 'e1',
  itemName: 'U12 · 男子单打',
  name: id,
  affiliation: '单位',
  contact: '13800000000',
  amountDue: 5000,
  paymentStatus: 'UNPAID',
  paidAmount: null,
  paidAt: null,
  confirmedByName: null,
  paymentNote: null,
  ...overrides,
});

const options = {
  groupOrder: ['g1', 'g2'],
  itemOrder: ['e1', 'e2', 't1'],
  groupName: (item) => ({ g1: 'U12', g2: 'U15' })[item.groupId] ?? '',
  formatTime: (value) => value.slice(0, 16).replace('T', ' '),
};

describe('缴费管理表格排序', () => {
  it('未缴费 → 已缴费 → 免缴 → 无需缴费', () => {
    assert.equal(paymentSortRank(row('a')), 0);
    assert.equal(paymentSortRank(row('b', { paymentStatus: 'PAID' })), 1);
    assert.equal(paymentSortRank(row('c', { paymentStatus: 'WAIVED' })), 2);
    assert.equal(paymentSortRank(row('d', { amountDue: 0 })), 3);
  });

  it('同一档位保持原来的顺序（项目、报名先后）', () => {
    const rows = [
      row('paid1', { paymentStatus: 'PAID' }),
      row('unpaid1'),
      row('free1', { amountDue: 0 }),
      row('waived1', { paymentStatus: 'WAIVED' }),
      row('unpaid2'),
      row('paid2', { paymentStatus: 'PAID' }),
    ];
    assert.deepEqual(sortPaymentRows(rows).map((item) => item.id), ['unpaid1', 'unpaid2', 'paid1', 'paid2', 'waived1', 'free1']);
    assert.equal(rows[0].id, 'paid1', '不改动原数组');
  });
});

describe('未缴费 / 已缴费名单', () => {
  const rows = [
    row('张三 已缴', { paymentStatus: 'PAID', paidAmount: 5000, paidAt: '2026-11-10T09:30:00', confirmedByName: 'admin' }),
    row('李四 / 王五', { groupId: 'g2', itemId: 'e2', itemName: 'U15 · 男子双打', amountDue: 8050 }),
    row('赵六 免缴', { paymentStatus: 'WAIVED', paidAmount: 0, paymentNote: '工作人员' }),
    row('孙七 无需', { amountDue: 0 }),
    row('张三 未缴', { itemId: 'e2', itemName: 'U12 · 男子双打', amountDue: 3000 }),
    row('某队', { itemId: 't1', itemName: 'U12团体赛', members: '甲、乙、丙', amountDue: 20000 }),
    row('未知组别', { groupId: 'gx', itemId: 'ex', amountDue: 100 }),
  ];

  it('两份名单合起来正好是需要缴费的全部，不收费的两份都不进', () => {
    const unpaid = rows.filter(isUnpaidDue).map((item) => item.id);
    const settled = rows.filter(isSettled).map((item) => item.id);
    assert.deepEqual(unpaid.sort(), ['张三 未缴', '李四 / 王五', '某队', '未知组别'].sort());
    assert.deepEqual(settled.sort(), ['张三 已缴', '赵六 免缴'].sort());
  });

  it('未缴费名单按组别、项目排序，末行合计按分求和再换成元', () => {
    const sheet = paymentListSheet(rows, 'UNPAID', options);
    assert.deepEqual(sheet.map((item) => item.参赛方), ['张三 未缴', '某队', '李四 / 王五', '未知组别', '']);
    assert.deepEqual(Object.keys(sheet[0]), ['序号', '组别', '项目', '参赛方', '队员', '单位', '联系方式', '应缴金额', '备注']);
    assert.equal(sheet[1].队员, '甲、乙、丙');
    assert.equal(sheet[2].组别, 'U15');
    assert.equal(sheet[2].应缴金额, 80.5);
    assert.deepEqual(sheet.at(-1), { 序号: '合计', 组别: '4 项', 项目: '', 参赛方: '', 队员: '', 单位: '', 联系方式: '', 应缴金额: 311.5, 备注: '' });
  });

  it('已缴费名单含免缴：状态列区分，免缴实缴记 0，合计只算已缴费的金额', () => {
    const sheet = paymentListSheet(rows, 'SETTLED', options);
    assert.equal(sheet.length, 3);
    assert.deepEqual(sheet[0], {
      序号: 1, 组别: 'U12', 项目: 'U12 · 男子单打', 参赛方: '张三 已缴', 队员: '', 单位: '单位', 联系方式: '13800000000',
      状态: '已缴费', 实缴金额: 50, 确认时间: '2026-11-10 09:30', 确认人: 'admin', 备注: '',
    });
    assert.equal(sheet[1].状态, '免缴');
    assert.equal(sheet[1].实缴金额, 0);
    assert.equal(sheet[1].备注, '工作人员');
    assert.equal(sheet[2].序号, '合计');
    assert.equal(sheet[2].组别, '2 项');
    assert.equal(sheet[2].实缴金额, 50);
  });

  it('兼项的人一项已缴、一项未缴时，两份名单各出现一次', () => {
    const unpaid = paymentListSheet(rows, 'UNPAID', options).map((item) => item.参赛方);
    const settled = paymentListSheet(rows, 'SETTLED', options).map((item) => item.参赛方);
    assert.ok(unpaid.includes('张三 未缴'));
    assert.ok(settled.includes('张三 已缴'));
  });

  it('没有符合条件的记录时返回空数组，不出合计行', () => {
    assert.deepEqual(paymentListSheet([row('a', { amountDue: 0 })], 'UNPAID', options), []);
    assert.deepEqual(paymentListSheet([row('a')], 'SETTLED', options), []);
  });
});
