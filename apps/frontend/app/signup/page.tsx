import Link from 'next/link';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

export default function SignupPage() {
  return (
    <PortalFeaturePage
      activeHref="/signup"
      eyebrow="Signup"
      title="报名入口"
      description="选择已发布赛事后进入报名流程，提交选手和参赛项目信息。"
    >
      <div className="rounded-lg border border-blue-100 bg-white p-8 shadow-sm">
        <h2 className="text-xl font-black">从赛事列表开始报名</h2>
        <p className="mt-2 text-sm font-semibold text-slate-500">
          当前报名入口按赛事开放，请先选择要参加的比赛。
        </p>
        <Link href="/competitions" className="mt-5 inline-flex h-11 items-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white">
          查看赛事列表
        </Link>
      </div>
    </PortalFeaturePage>
  );
}
