import Image from 'next/image';
import Link from 'next/link';

const features = [
  {
    title: '赛事报名',
    description: '报名信息提交、参赛名单查看与资格管理。',
    icon: '/generated/icon-edit.svg',
    href: '#competitions',
    gradient: 'from-blue-600 to-cyan-400',
  },
  {
    title: '对阵生成',
    description: '抽签编排、淘汰赛树与小组赛对阵。',
    icon: '/generated/icon-bracket.svg',
    href: '/admin/draws',
    gradient: 'from-indigo-500 to-blue-500',
  },
  {
    title: '成绩统计',
    description: '实时记录比分，沉淀比赛成绩数据。',
    icon: '/generated/icon-rank.svg',
    href: '/login',
    gradient: 'from-orange-400 to-amber-300',
  },
  {
    title: '后台管理',
    description: '赛事、选手、裁判、抽签与记分统一管理。',
    icon: '/generated/icon-user.svg',
    href: '/admin',
    gradient: 'from-sky-500 to-blue-700',
  },
];

export function FeatureEntrances() {
  return (
    <section id="features" className="bg-white px-6 py-12 text-slate-950 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Platform Features</p>
          <h2 className="mt-2 text-3xl font-black md:text-4xl">平台功能入口</h2>
          <p className="mt-3 text-sm font-semibold text-slate-500">
            面向校园与社团赛事组织，覆盖报名、编排、记分与成绩管理。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {features.map((feature) => (
            <Link
              key={feature.title}
              href={feature.href}
              className="group relative min-h-44 overflow-hidden rounded-2xl border border-blue-100 bg-white/95 p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className={`pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full bg-gradient-to-br ${feature.gradient} opacity-20 blur-xl`} />
              <div className={`relative z-10 flex h-12 w-12 min-w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${feature.gradient}`}>
                <Image src={feature.icon} alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
              </div>
              <h3 className="relative z-10 mt-5 text-lg font-black text-slate-950">{feature.title}</h3>
              <p className="relative z-10 mt-2 text-sm leading-6 text-slate-500">{feature.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
