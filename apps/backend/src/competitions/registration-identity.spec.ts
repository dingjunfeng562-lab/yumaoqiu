import { PrismaService } from '../prisma/prisma.service';
import { CompetitionsService } from './competitions.service';

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const identity = (fingerprint: string) => ({
  fingerprint,
  birthDate: '2010-01-01',
  masked: '110***********1234',
});

type Row = {
  id: string;
  name: string;
  contact: string | null;
  studentId: string | null;
  identityData: ReturnType<typeof identity> | null;
  eventItems: Array<{
    eventId: string;
    partnerIdentityData: ReturnType<typeof identity> | null;
  }>;
};

function buildService(rows: Row[]) {
  const competitionRegistration = {
    findMany: jest.fn(() => Promise.resolve(rows)),
  };
  const service = new CompetitionsService(
    { competitionRegistration } as unknown as PrismaService,
    {} as never,
  );
  const analyze = (
    service as unknown as {
      analyzePersonRegistrations: (
        competitionId: string,
        person: {
          name: string;
          contact: string;
          studentId?: string | null;
          fingerprint?: string | null;
        },
      ) => Promise<{ ownRows: Row[]; partnerEventIds: Set<string> }>;
    }
  ).analyzePersonRegistrations.bind(service);
  return { competitionRegistration, analyze };
}

describe('兼项认人：姓名 + 身份证 / 学号 / 手机号', () => {
  it('换了手机号，但身份证一致：仍然认成同一个人', async () => {
    const { analyze } = buildService([
      {
        id: 'r1',
        name: '陈军军',
        contact: '13899689632',
        studentId: null,
        identityData: identity(FP_A),
        eventItems: [{ eventId: 'mixed', partnerIdentityData: null }],
      },
    ]);
    const result = await analyze('t1', {
      name: '陈军军',
      contact: '13896689632',
      fingerprint: FP_A,
    });
    expect(result.ownRows.map((row) => row.id)).toEqual(['r1']);
  });

  it('换了手机号，身份证也不同：不算同一个人（同名不同人）', async () => {
    const { analyze } = buildService([
      {
        id: 'r1',
        name: '陈军军',
        contact: '13899689632',
        studentId: null,
        identityData: identity(FP_A),
        eventItems: [{ eventId: 'mixed', partnerIdentityData: null }],
      },
    ]);
    const result = await analyze('t1', {
      name: '陈军军',
      contact: '13896689632',
      fingerprint: FP_B,
    });
    expect(result.ownRows).toEqual([]);
  });

  it('同一手机号但姓名不同（家人共用号码）：不算同一个人', async () => {
    const { analyze } = buildService([
      {
        id: 'r1',
        name: '薛金刚',
        contact: '18309945558',
        studentId: null,
        identityData: identity(FP_A),
        eventItems: [{ eventId: 'ms', partnerIdentityData: null }],
      },
    ]);
    const result = await analyze('t1', {
      name: '惠飞飞',
      contact: '18309945558',
      fingerprint: FP_B,
    });
    expect(result.ownRows).toEqual([]);
  });

  it('姓名 + 学号一致、手机号不同：也认成同一个人（有学号的组别）', async () => {
    const { analyze } = buildService([
      {
        id: 'r1',
        name: '张三',
        contact: '13300000001',
        studentId: '2026001',
        identityData: null,
        eventItems: [{ eventId: 'ms', partnerIdentityData: null }],
      },
    ]);
    const result = await analyze('t1', {
      name: '张三',
      contact: '13300000002',
      studentId: '2026001',
    });
    expect(result.ownRows.map((row) => row.id)).toEqual(['r1']);
  });

  it('身份证一致但姓名写错：能认出来，交给调用方提示核对姓名', async () => {
    const { analyze } = buildService([
      {
        id: 'r1',
        name: '陈军军',
        contact: '13899689632',
        studentId: null,
        identityData: identity(FP_A),
        eventItems: [{ eventId: 'mixed', partnerIdentityData: null }],
      },
    ]);
    const result = await analyze('t1', {
      name: '陈建军',
      contact: '13896689632',
      fingerprint: FP_A,
    });
    expect(result.ownRows.map((row) => row.id)).toEqual(['r1']);
  });

  it('以搭档身份出现在别人的混双里：计入兼项项目，但不当作自己的报名', async () => {
    const { analyze } = buildService([
      {
        id: 'r1',
        name: '王虎',
        contact: '18097823287',
        studentId: null,
        identityData: identity(FP_B),
        eventItems: [{ eventId: 'mixed', partnerIdentityData: identity(FP_A) }],
      },
    ]);
    const result = await analyze('t1', {
      name: '武苏杰',
      contact: '16690016558',
      fingerprint: FP_A,
    });
    expect(result.ownRows).toEqual([]);
    expect([...result.partnerEventIds]).toEqual(['mixed']);
  });

  it('同一个赛事里既报男单又是混双搭档：两部分都会进兼项计数', async () => {
    const { analyze } = buildService([
      {
        id: 'r1',
        name: '张耀',
        contact: '18196002583',
        studentId: null,
        identityData: identity(FP_A),
        eventItems: [{ eventId: 'ms', partnerIdentityData: null }],
      },
      {
        id: 'r2',
        name: '邵嘉',
        contact: '18106409465',
        studentId: null,
        identityData: identity(FP_B),
        eventItems: [{ eventId: 'mixed', partnerIdentityData: identity(FP_A) }],
      },
    ]);
    const result = await analyze('t1', {
      name: '张耀',
      contact: '18196002583',
      fingerprint: FP_A,
    });
    expect(result.ownRows.map((row) => row.id)).toEqual(['r1']);
    expect([...result.partnerEventIds]).toEqual(['mixed']);
  });
});
