export type PlatformCompetitionStatus = '报名中' | '即将开始' | '进行中' | '已结束' | string;

export type PlatformCompetition = {
  id: string;
  title: string;
  subtitle?: string | null;
  status: PlatformCompetitionStatus;
  startDate: string;
  endDate: string;
  projects: string[];
  location: string;
  registeredCount: number;
  teamCompetitionCount?: number;
  teamCount?: number;
  formatText?: string | null;
  description?: string | null;
  cover: string;
};
