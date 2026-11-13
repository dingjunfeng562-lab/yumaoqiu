'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Modal, message } from 'antd';
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

type MatchSignatureModalProps = {
  open: boolean;
  title: string;
  /** 第一步「核对结果」里展示的内容（比分、弃权方等）。 */
  summary: ReactNode;
  /** 胜方；双方弃权没有胜方时传 null，只要裁判签字。 */
  winner: SignatureWinner | null;
  refereeName: string;
  submitText: string;
  submitting: boolean;
  onCancel: () => void;
  /** 提交签名并结束比赛；成功返回 true（由调用方关闭弹窗），失败返回 false，签名保留可重试。 */
  onSubmit: (signatures: MatchSignaturesPayload) => Promise<boolean>;
};

/** 签字板高度跟着屏幕走：横屏手机只有三四百像素高，平板可以大一些。 */
function padHeightForViewport() {
  if (typeof window === 'undefined') return 220;
  return Math.max(130, Math.min(280, window.innerHeight - 250));
}

/**
 * 比赛结束签字：核对结果 → 胜方签字（双打两人选一人）→ 裁判签字 → 提交。
 * 赛事开启「比赛结束需签字」时，裁判端的结束、弃权、退赛、黑牌都先走这里。
 */
export default function MatchSignatureModal({
  open,
  title,
  summary,
  winner,
  refereeName,
  submitText,
  submitting,
  onCancel,
  onSubmit,
}: MatchSignatureModalProps) {
  const [messageApi, messageHolder] = message.useMessage();
  const [step, setStep] = useState<Step>('review');
  const [signerIndex, setSignerIndex] = useState<number | null>(null);
  const [winnerSignature, setWinnerSignature] = useState<string | null>(null);
  const [padEmpty, setPadEmpty] = useState(true);
  const [padHeight, setPadHeight] = useState(220);
  const padRef = useRef<SignaturePadHandle>(null);
  const players = winner?.players ?? [];

  useEffect(() => {
    if (!open) return;
    setStep('review');
    setWinnerSignature(null);
    setPadEmpty(true);
    setSignerIndex(players.length === 1 ? players[0].index : null);
    setPadHeight(padHeightForViewport());
    // 只在每次打开时重置；players 每次渲染都是新数组，不能放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPadHeight(padHeightForViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

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
    <Modal
      open={open}
      title={title}
      width="min(960px, 96vw)"
      centered
      mask={{ closable: false }}
      keyboard={false}
      destroyOnHidden
      okText="确定"
      cancelText="取消"
      onCancel={submitting ? undefined : onCancel}
      footer={footer}
      styles={{ body: { paddingTop: 4 } }}
    >
      {messageHolder}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold">
        {stepItems.map((item, index) => (
          <span
            key={item.key}
            className={`rounded-full px-3 py-1 ${
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

      {step === 'review' ? (
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
      ) : null}

      {step === 'winner' && winner ? (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-700">
            请胜方 <strong className="text-emerald-700">{winner.sideLabel} {winner.name}</strong> 核对比分后签字
          </div>
          {players.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500">签字选手（两人中一人签即可）：</span>
              {players.map((player) => (
                <Button
                  key={player.index}
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
            height={players.length > 1 ? Math.max(120, padHeight - 44) : padHeight}
            placeholder={signerName ? `${signerName} 请在框内签名` : '胜方选手请在框内签名'}
            onChange={setPadEmpty}
          />
        </div>
      ) : null}

      {step === 'referee' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700">
              请裁判 <strong className="text-blue-700">{refereeName}</strong> 签字确认
            </div>
            {winner && winnerSignature ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>胜方已签（{signerName}）</span>
                {/* 签名是本机刚生成的 data URL，不走 next/image。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={winnerSignature} alt="胜方签名" className="h-10 rounded border border-slate-200 bg-white px-1" />
              </div>
            ) : null}
          </div>
          <SignaturePad
            key="referee-pad"
            ref={padRef}
            height={padHeight}
            placeholder="裁判请在框内签名"
            onChange={setPadEmpty}
          />
        </div>
      ) : null}
    </Modal>
  );
}
