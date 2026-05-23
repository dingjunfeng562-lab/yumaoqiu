import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#eef5ff] px-5 text-slate-950">
      <section className="w-full max-w-md rounded-lg border border-blue-100 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">403</p>
        <h1 className="mt-3 text-2xl font-black">无权访问</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
          当前账号没有访问该页面的权限。
        </p>
        <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-3 text-left text-xs font-semibold leading-6 text-slate-600">
          <p className="text-[11px] font-black uppercase tracking-wider text-blue-700">角色权限速览</p>
          <ul className="mt-2 space-y-1">
            <li>· <strong>总管理员</strong> 创建账号 / 审核赛事 / 全部后台权限</li>
            <li>· <strong>管理员</strong> 创建/编辑赛事(需总管理员审核),其他后台模块</li>
            <li>· <strong>裁判</strong> 仅记分页面,无后台权限</li>
            <li>· <strong>选手</strong> 仅可查看本人报名信息</li>
          </ul>
        </div>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-blue-700 px-5 text-sm font-black text-white transition hover:bg-blue-800"
        >
          返回首页
        </Link>
      </section>
    </main>
  );
}
