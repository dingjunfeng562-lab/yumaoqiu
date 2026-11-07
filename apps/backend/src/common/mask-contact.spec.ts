import { maskContact } from './mask-contact';

describe('公开页面联系方式打码', () => {
  it('手机号保留前3后4', () => {
    expect(maskContact('13812345678')).toBe('138****5678');
    expect(maskContact(' 138 1234 5678 ')).toBe('138****5678');
  });
  it('其他写法也不露出完整内容', () => {
    expect(maskContact('023-68881234')).toBe('023****1234');
    expect(maskContact('wx_abc123')).toBe('wx****23');
    expect(maskContact('qq12')).toBe('q****2');
    expect(maskContact('ab')).toBe('****');
  });
  it('占位写法和空值视为未填', () => {
    for (const value of ['无', '-', '', '  ', null, undefined]) expect(maskContact(value)).toBe('');
  });
});
