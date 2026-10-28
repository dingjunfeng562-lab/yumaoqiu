import { MatchEventType } from '@prisma/client';
import { ScoringService } from './scoring.service';

/**
 * 双打发球/接发站位规则。
 *
 * 约定：sideXPositions 里的 left/right 是「该名选手面向球网时的左右手边」，
 * 也就是 BWF 的「本方左/右发球区」。发球方与接发方各自看到的左右是镜像的，
 * 所以发球员站右发球区时，接发球员站的是他自己那一侧的右发球区（同名，互为对角）。
 */
describe('ScoringService 发球/接发站位', () => {
  function setup() {
    const service = new ScoringService({} as any, {} as any, {} as any, {} as any) as any;
    const parseState = (note: string) => service.decodeServingState(note);
    const encodeState = (state: any) => service.encodeServingState(state);
    return { service, parseState, encodeState };
  }

  describe('0:0 开局', () => {
    it('发球员在右发球区，接发球员在接发方自己的右发球区', () => {
      const { service } = setup();
      const state = service.initialServingState(1, 1, 1, null, { forceServerRight: true });

      expect(state.serverCourtSide).toBe('right');
      expect(state.serverPlayerIndex).toBe(1);
      expect(state.receiverCourtSide).toBe('right');
      expect(state.receiverPlayerIndex).toBe(1);
      // 接发方 P1 站在他自己那一侧的右发球区
      expect(state.side2Positions.right).toBe(1);
      expect(state.side2Positions.left).toBe(2);
    });

    it('裁判选了 2 号位发球/接发时，双方都摆到各自右发球区', () => {
      const { service } = setup();
      const state = service.initialServingState(1, 1, 2, null, {
        receiverPlayerIndex: 2,
        forceServerRight: true,
      });

      expect(state.serverPlayerIndex).toBe(2);
      expect(state.serverCourtSide).toBe('right');
      expect(state.side1Positions).toEqual({ right: 2, left: 1 });
      expect(state.receiverPlayerIndex).toBe(2);
      expect(state.receiverCourtSide).toBe('right');
      expect(state.side2Positions).toEqual({ right: 2, left: 1 });
    });
  });

  describe('一分之后的轮转', () => {
    it('发球方得分：两人交换发球区，发球员不变', () => {
      const { service } = setup();
      const state = service.initialServingState(1, 1, 1, null, { forceServerRight: true });
      const next = service.nextServingState(state, 1, 1, 0);

      expect(next.servingSide).toBe(1);
      expect(next.serverPlayerIndex).toBe(1);
      expect(next.serverCourtSide).toBe('left');
      expect(next.side1Positions).toEqual({ right: 2, left: 1 });
      expect(next.receiverCourtSide).toBe('left');
    });

    it('接发方得分：站位不动，由站在对应发球区的人发球', () => {
      const { service } = setup();
      const state = service.initialServingState(1, 1, 1, null, { forceServerRight: true });
      const afterServeWin = service.nextServingState(state, 1, 1, 0);
      const afterReceiveWin = service.nextServingState(afterServeWin, 2, 1, 1);

      expect(afterReceiveWin.servingSide).toBe(2);
      // 接发方比分变 1（奇数）→ 左发球区的人发球
      expect(afterReceiveWin.serverCourtSide).toBe('left');
      expect(afterReceiveWin.serverPlayerIndex).toBe(
        afterReceiveWin.side2Positions.left,
      );
      // 接发方（现在是发球方的对手）站位不应该因为这一分而变化
      expect(afterReceiveWin.side1Positions).toEqual(afterServeWin.side1Positions);
    });

    it('连续十个回合里，接发球员始终站在接发方同名的发球区，发球员始终站在比分奇偶对应的发球区', () => {
      const { service } = setup();
      const rally = [1, 1, 2, 1, 2, 2, 1, 2, 1, 1];
      let state = service.initialServingState(1, 1, 1, null, { forceServerRight: true });
      let side1Score = 0;
      let side2Score = 0;

      for (const scoringSide of rally) {
        if (scoringSide === 1) side1Score += 1;
        else side2Score += 1;
        state = service.nextServingState(state, scoringSide, side1Score, side2Score);

        const servingPositions = state.servingSide === 1 ? state.side1Positions : state.side2Positions;
        const receivingPositions = state.receivingSide === 1 ? state.side1Positions : state.side2Positions;
        const servingScore = state.servingSide === 1 ? side1Score : side2Score;

        expect(state.serverCourtSide).toBe(servingScore % 2 === 0 ? 'right' : 'left');
        expect(servingPositions[state.serverCourtSide]).toBe(state.serverPlayerIndex);
        expect(state.receiverCourtSide).toBe(state.serverCourtSide);
        expect(receivingPositions[state.receiverCourtSide]).toBe(state.receiverPlayerIndex);
      }
    });

    it('单打：接发方只有一个人时不会把接发球员换成不存在的 2 号位', () => {
      const { service } = setup();
      const state = service.initialServingState(1, 1, 1, null, { forceServerRight: true });
      const sanitized = service.sanitizeServingState(state, 1, 1);
      const next = service.nextServingState(sanitized, 1, 1, 0);

      expect(next.receiverPlayerIndex).toBe(1);
    });
  });

  describe('新一局', () => {
    it('由上一局胜方先发球，默认发球员与接发球员都在各自右发球区', () => {
      const { service } = setup();
      const endOfGame = {
        gameNo: 1,
        servingSide: 1,
        serverPlayerIndex: 1,
        serverCourtSide: 'left',
        receivingSide: 2,
        receiverPlayerIndex: 1,
        receiverCourtSide: 'left',
        side1Positions: { right: 2, left: 1 },
        side2Positions: { right: 2, left: 1 },
        source: 'referee',
      };
      const nextGame = service.initialServingState(2, 2, 1, endOfGame, { forceServerRight: true });

      expect(nextGame.gameNo).toBe(2);
      expect(nextGame.servingSide).toBe(2);
      expect(nextGame.serverPlayerIndex).toBe(1);
      expect(nextGame.serverCourtSide).toBe('right');
      expect(nextGame.side2Positions).toEqual({ right: 1, left: 2 });
      expect(nextGame.receiverCourtSide).toBe('right');
      expect(nextGame.receiverPlayerIndex).toBe(nextGame.side1Positions.right);
    });
  });

  describe('历史数据自愈', () => {
    it('早期按「另一侧发球区」存下的接发球员，读取时按站位纠正', () => {
      const { service } = setup();
      const broken = {
        gameNo: 1,
        servingSide: 1,
        serverPlayerIndex: 1,
        serverCourtSide: 'right',
        receivingSide: 2,
        // 修正前算出来的错人：发球方右区时错误地取了接发方的左区
        receiverPlayerIndex: 2,
        receiverCourtSide: 'left',
        side1Positions: { right: 1, left: 2 },
        side2Positions: { right: 1, left: 2 },
        source: 'referee',
      };

      const fixed = service.sanitizeServingState(broken, 2, 2);
      expect(fixed.receiverPlayerIndex).toBe(1);
      expect(fixed.receiverCourtSide).toBe('right');
    });
  });

  describe('发球状态的存取', () => {
    it('来源标记（system/referee）可以往返', () => {
      const { service } = setup();
      const state = {
        ...service.initialServingState(2, 2, 1, null, { forceServerRight: true }),
        source: 'system',
      };
      const decoded = service.decodeServingState(service.encodeServingState(state));
      expect(decoded.source).toBe('system');
      expect(decoded.servingSide).toBe(2);
      expect(decoded.serverPlayerIndex).toBe(1);
      expect(decoded.receiverPlayerIndex).toBe(state.receiverPlayerIndex);
    });

    it('老备注没有来源标记时按「裁判已确认」处理', () => {
      const { service } = setup();
      const note = service.encodeServingState(
        service.initialServingState(1, 1, 1, null, { forceServerRight: true }),
      );
      const legacy = note.split('|').slice(0, -1).join('|');
      expect(service.decodeServingState(legacy)?.source).toBe('referee');
    });

    it('重放历史事件时以每分记录的发球状态为准', () => {
      const { service } = setup();
      const start = service.initialServingState(1, 1, 1, null, { forceServerRight: true });
      const afterPoint = service.nextServingState(start, 1, 1, 0);
      const games = [{ gameNo: 1, server: 1 }];
      const events = [
        {
          type: MatchEventType.SERVE_CHANGE,
          side: 1,
          gameNo: 1,
          side1Score: 0,
          side2Score: 0,
          note: service.encodeServingState(start),
          undoneAt: null,
        },
        {
          type: MatchEventType.POINT,
          side: 1,
          gameNo: 1,
          side1Score: 1,
          side2Score: 0,
          note: service.encodeServingState(afterPoint),
          undoneAt: null,
        },
      ];

      const replay = service.buildServingState(games, events, 1, 2, 2);
      expect(replay.serverPlayerIndex).toBe(1);
      expect(replay.serverCourtSide).toBe('left');
      expect(replay.receiverCourtSide).toBe('left');
      expect(replay.receiverPlayerIndex).toBe(replay.side2Positions.left);
    });
  });

  describe('换边展示', () => {
    it('每局结束双方换边，卡片左右随局数交替', () => {
      const { service } = setup();
      expect(service.computeCourtDisplayState([], 1).side1CourtSide).toBe('left');
      expect(service.computeCourtDisplayState([], 2).side1CourtSide).toBe('right');
      expect(service.computeCourtDisplayState([], 3).side1CourtSide).toBe('left');
    });

    it('决胜局 11 分换边在局内再翻一次', () => {
      const { service } = setup();
      const swapEvent = { note: 'COURT_SWAP:3' };
      expect(service.computeCourtDisplayState([swapEvent], 3).side1CourtSide).toBe('right');
    });
  });
});
