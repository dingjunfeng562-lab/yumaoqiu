import { defaultTeamCompetitionName, teamCompetitionLabel } from './team-competition-label';

describe('团体赛名称跟着组别走', () => {
  it('新建团体赛自动取「组别名团体赛」', () => {
    expect(defaultTeamCompetitionName(' U12组 ')).toBe('U12组团体赛');
  });
  it('自动名称原样显示，不会出现「学生组团体赛 · 学生组团体赛」', () => {
    expect(teamCompetitionLabel('学生组团体赛', '学生组')).toBe('学生组团体赛');
    expect(teamCompetitionLabel('学生组团体赛')).toBe('学生组团体赛');
  });
  it('早期手填的名称保留，前面补上组别', () => {
    expect(teamCompetitionLabel('院系杯', '学生组')).toBe('学生组团体赛 · 院系杯');
    expect(teamCompetitionLabel('院系杯')).toBe('团体赛 · 院系杯');
  });
});
