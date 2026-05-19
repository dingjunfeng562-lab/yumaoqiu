export type PlatformCompetitionStatus = '报名中' | '即将开始' | '进行中' | '已结束';

export type PlatformCompetition = {
  id: string;
  title: string;
  status: PlatformCompetitionStatus;
  startDate: string;
  endDate: string;
  projects: string[];
  location: string;
  registeredCount: number;
  cover: string;
};
