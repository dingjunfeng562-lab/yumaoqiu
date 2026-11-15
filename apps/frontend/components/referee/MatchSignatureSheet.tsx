'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Alert, Button, message } from 'antd';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';

export type MatchSignaturesPayload = {
  winnerSignature?: string;
  winnerSignerIndex?: number;
  refereeSignature: string;
};

export type SignatureWinner = {
  /** 例如「A方」。 */
  sideLabel: string;
  name: string;
  players: Array<{ index: number; name: string }>;
};

type Step = 'review' | 'winner' | 'referee';

type MatchSignatureSheetProps = {
  title: string;
  /** 第一步「核对结果」里展示的内容（比分、弃权方等）。 */
  summary: ReactNode;
  /** 胜方；双方弃权没有胜方时传 null，只要裁判签字。 */
  winner: SignatureWinner | null;
  refereeName: string;
  submitText: string;
  submitting: boolean;
  onCancel: () => void;
  /** 提交签名并结束比赛；成功返回 true（由调用方关闭），失败返回 false，签名保留可重试。 */
  onSubmit: (signatures: MatchSignaturesPayload) => Promise<boolean>;
};

/**
 * 比赛结束签字：核对结果 → 胜方签字（双打两人选一人）→ 裁判签字 → 提交。
 *
 * 用整屏签字层而不是 antd Modal：手机（尤其被 RefereeLandscapeGate 旋转成横屏兜底的
 * 记分台）里，Modal 会缩在竖屏宽度那么高的盒子里，签字板被裁、手势又被 touch-action
 * 吃掉，裁判只能签在露出来的一小块里，看起来就是「签字不完整、划不动」。
 * 这一层固定铺满当前可见区域，里面没有滚动容器，签字板吃满剩余高度。
 */
export default function MatchSignatureSheet({
  title,
  summary,
  winner,
  refereeName,
  submitText,
  submitting,
  onCancel,
  onSubmit,
}: MatchSignatureSheetProps) {
  const [messageApi, messageHolder] = message.useMessage();
  // 这一层由调用方在需要签字时挂载、签完卸载，所以初始状态按挂载那一刻算即可。
  const [step, setStep] = useState<Step>('review');
  const [signerIndex, setSignerIndex] = useState<number | null>(() => {
    const players = winner?.players ?? [];
    return players.length === 1 ? players[0].index : null;
  });
  const [winnerSignature, setWinnerSignature] = useState<string | null>(null);
  const [padEmpty, setPadEmpty] = useState(true);
  const padRef = useRef<SignaturePadHandle>(null);
  const players = winner?.players ?? [];

  const signerName = players.find((player) => player.index === signerIndex)?.name ?? winner?.name ?? '';

  function goNextFromReview() {
    setPadEmpty(true);
    setStep(winner ? 'winner' : 'referee');
  }

  function confirmWinner() {
    if (players.length > 1 && !signerIndex) {
      messageApi.warning('请先选择由哪位胜方选手签字');
      return;
    }
    const url = padRef.current?.toDataUrl() ?? null;
    if (!url) {
      messageApi.warning('签名太短或没有签，请胜方选手在框内签名');
      return;
    }
    setWinnerSignature(url);
    setPadEmpty(true);
    setStep('referee');
  }

  async function submit() {
    const url = padRef.current?.toDataUrl() ?? null;
    if (!url) {
      messageApi.warning('签名太短或没有签，请裁判在框内签名');
      return;
    }
    if (winner && !winnerSignature) {
      setStep('winner');
      return;
    }
    await onSubmit({
      refereeSignature: url,
      ...(winner && winnerSignature
        ? { winnerSignature, ...(signerIndex ? { winnerSignerIndex: signerIndex } : {}) }
        : {}),
    });
  }

  const stepItems: Array<{ key: Step; label: string }> = [
    { key: 'review', label: '核对结果' },
    ...(winner ? [{ key: 'winner' as Step, label: '胜方签字' }] : []),
    { key: 'referee', label: '裁判签字' },
  ];
  const currentIndex = stepItems.findIndex((item) => item.key === step);

  let footer: ReactNode;
  if (step === 'review') {
    footer = [
      <Button key="cancel" onClick={onCancel}>取消</Button>,
      <Button key="next" type="primary" onClick={goNextFromReview}>
        {winner ? '下一步：胜方签字' : '下一步：裁判签字'}
      </Button>,
    ];
  } else if (step === 'winner') {
    footer = [
      <Button key="back" onClick={() => setStep('review')}>上一步</Button>,
      <Button key="clear" onClick={() => padRef.current?.clear()} disabled={padEmpty}>清除重签</Button>,
      <Button
        key="next"
        type="primary"
        onClick={confirmWinner}
        disabled={padEmpty || (players.length > 1 && !signerIndex)}
      >
        下一步：裁判签字
      </Button>,
    ];
  } else {
    footer = [
      <Button
        key="back"
        onClick={() => {
          setWinnerSignature(null);
          setPadEmpty(true);
          setStep(winner ? 'winner' : 'review');
        }}
        disabled={submitting}
      >
        {winner ? '胜方重签' : '上一步'}
      </Button>,
      <Button key="clear" onClick={() => padRef.current?.clear()} disabled={padEmpty || submitting}>清除重签</Button>,
      <Button key="submit" type="primary" danger onClick={() => void submit()} loading={submitting} disabled={padEmpty}>
        {submitText}
      </Button>,
    ];
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[1200] flex flex-col bg-white text-slate-800"
      style={{ overscrollBehavior: 'none' }}
    >
      {messageHolder}
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black leading-tight text-slate-900">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
            {stepItems.map((item, index) => (
              <span
                key={item.key}
                className={`rounded-full px-2 py-0.5 ${
                  index === currentIndex
                    ? 'bg-blue-600 text-white'
                    : index < currentIndex
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {index + 1}. {item.label}
              </span>
            ))}
          </div>
        </div>
        <Button size="small" onClick={onCancel} disabled={submitting}>取消</Button>
      </header>

      {step === 'review' ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
          style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
        >
          <div className="space-y-3">
            {summary}
            <Alert
              type="info"
              showIcon
              title={
                winner
                  ? '本赛事要求比赛结束时签字确认：请胜方选手核对比分后签字，再由裁判签字。提交后本场比赛正式结束。'
                  : '本赛事要求比赛结束时签字确认：本场没有胜方，由裁判签字后提交。'
              }
            />
          </div>
        </div>
      ) : null}

      {step === 'winner' && winner ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
          <div className="shrink-0 text-sm font-semibold text-slate-700">
            请胜方 <strong className="text-emerald-700">{winner.sideLabel} {winner.name}</strong> 核对比分后签字
          </div>
          {players.length > 1 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">签字选手（两人中一人签即可）：</span>
              {players.map((player) => (
                <Button
                  key={player.index}
                  size="small"
                  type={signerIndex === player.index ? 'primary' : 'default'}
                  onClick={() => setSignerIndex(player.index)}
                >
                  {player.name}
                </Button>
              ))}
            </div>
          ) : null}
          <SignaturePad
            key="winner-pad"
            ref={padRef}
            fill
            placeholder={signerName ? `${signerName} 请在框内签名` : '胜方选手请在框内签名'}
            onChange={setPadEmpty}
          />
        </div>
      ) : null}

      {step === 'referee' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700">
              请裁判 <strong className="text-blue-700">{refereeName}</strong> 签字确认
            </div>
            {winner && winnerSignature ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>胜方已签（{signerName}）</span>
                {/* 签名是本机刚生成的 data URL，不走 next/image。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={winnerSignature} alt="胜方签名" className="h-9 rounded border border-slate-200 bg-white px-1" />
              </div>
            ) : null}
          </div>
          <SignaturePad
            key="referee-pad"
            ref={padRef}
            fill
            placeholder="裁判请在框内签名"
            onChange={setPadEmpty}
          />
        </div>
      ) : null}

      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-3 py-2 [&_.ant-btn]:shrink-0">
        {footer}
      </footer>
    </div>
  );
}
