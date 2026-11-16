import { BadRequestException } from '@nestjs/common';
import {
  assertAdminContact,
  assertMobileContact,
  isLandline,
  isMainlandMobile,
} from './contact';

describe('联系方式真实校验', () => {
  it('认 11 位手机号，容忍空格、横线、括号和 +86', () => {
    expect(isMainlandMobile('13800138000')).toBe(true);
    expect(isMainlandMobile('138 0013 8000')).toBe(true);
    expect(isMainlandMobile('+8613800138000')).toBe(true);
    expect(isMainlandMobile('(138)0013-8000')).toBe(true);
  });

  it('不认占位号码和错误号段', () => {
    expect(isMainlandMobile('1')).toBe(false);
    expect(isMainlandMobile('00')).toBe(false);
    expect(isMainlandMobile('11111111111')).toBe(false);
    expect(isMainlandMobile('12800138000')).toBe(false);
    expect(isMainlandMobile('1380013800')).toBe(false);
    expect(isMainlandMobile('138001380001')).toBe(false);
    expect(isMainlandMobile('')).toBe(false);
  });

  it('座机按区号 + 7~8 位号码判断', () => {
    expect(isLandline('0994-1234567')).toBe(true);
    expect(isLandline('01012345678')).toBe(true);
    expect(isLandline('13800138000')).toBe(false);
  });

  it('线上报名必须是真实手机号，否则给出可读提示', () => {
    expect(assertMobileContact('13800138000')).toBe('13800138000');
    expect(() => assertMobileContact('')).toThrow(BadRequestException);
    expect(() => assertMobileContact('1')).toThrow(
      '联系方式须填写 11 位手机号',
    );
    expect(() => assertMobileContact('1', '搭档联系方式')).toThrow(
      '搭档联系方式须填写 11 位手机号',
    );
  });

  it('后台代录允许座机，但仍然挡掉「1」「00」这类占位号码', () => {
    expect(assertAdminContact('13800138000')).toBe('13800138000');
    expect(assertAdminContact('0994-1234567')).toBe('0994-1234567');
    expect(assertAdminContact('1878324018')).toBe('1878324018');
    expect(() => assertAdminContact('1')).toThrow(BadRequestException);
    expect(() => assertAdminContact('00')).toThrow(BadRequestException);
    expect(() => assertAdminContact('abc')).toThrow(BadRequestException);
  });
});
