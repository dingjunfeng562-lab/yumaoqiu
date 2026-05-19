import Image from 'next/image';

export function Footer() {
  return (
    <footer
      className="bg-[#05215a] bg-cover bg-center text-white"
      style={{ backgroundImage: "url('/generated/footer-pattern.svg')" }}
    >
      <div className="mx-auto grid max-w-[1440px] gap-7 px-6 py-8 md:grid-cols-3 lg:px-8">
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="" width={1536} height={1024} className="h-12 w-[72px] object-contain" />
          <div>
            <p className="text-lg font-black">羽动云赛</p>
            <p className="mt-1 text-blue-100">羽毛球赛事管理平台</p>
          </div>
        </div>
        <div className="border-white/15 md:border-l md:pl-8">
          <p className="text-lg font-black">平台入口</p>
          <p className="mt-2 text-blue-100">赛事报名、赛程管理、对阵生成、成绩统计</p>
        </div>
        <div className="border-white/15 md:border-l md:pl-8">
          <p className="text-lg font-black">© 2026 羽动云赛</p>
          <p className="mt-2 text-blue-100">All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}
