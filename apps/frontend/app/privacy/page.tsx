import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

export const metadata: Metadata = {
  title: '隐私政策 | 羽动云赛',
  description: '羽动云赛隐私政策：说明我们如何收集、使用、存储、共享和保护你的个人信息，以及你享有的权利。',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-black text-slate-900 sm:text-lg">{title}</h2>
      <div className="mt-2 space-y-2 text-[13px] leading-7 text-slate-600 sm:text-sm">{children}</div>
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <PortalFeaturePage
      activeHref="/privacy"
      eyebrow="Privacy Policy"
      title="隐私政策"
      description="我们深知个人信息对你的重要性。本政策说明羽动云赛如何收集、使用、存储、共享和保护你的个人信息，以及你可以如何行使自己的权利。"
    >
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white px-5 py-7 shadow-[0_10px_30px_rgba(15,30,80,0.06)] sm:px-9 sm:py-10">
        <p className="text-xs font-bold text-slate-400">更新日期：2026 年 10 月 17 日</p>
        <p className="mt-1 text-xs font-bold text-slate-400">生效日期：2026 年 10 月 17 日</p>

        <p className="mt-5 text-[13px] leading-7 text-slate-600 sm:text-sm">
          羽动云赛（以下简称「本平台」，域名 ydysyumao.cn）由赛事组织方运营，为用户提供羽毛球赛事报名、赛程编排、成绩统计、赛事图片与直播等服务。本政策适用于你访问和使用本平台的全部功能。请你在注册或使用前仔细阅读并理解本政策；你开始使用本平台，即表示你已阅读并同意本政策。
        </p>

        <Section title="一、我们收集哪些信息">
          <p>为实现下述服务目的，我们可能收集以下信息：</p>
          <List
            items={[
              <>
                <strong className="font-bold text-slate-800">账号与身份信息</strong>：注册或登录时提交的用户名、邮箱地址、密码（以不可逆的加密方式存储，我们无法查看你的明文密码），以及在账户设置中补充的昵称、头像等资料。
              </>,
              <>
                <strong className="font-bold text-slate-800">赛事参与信息</strong>：报名或参赛时提交的姓名、性别、联系方式、所属单位或队伍、参赛项目、对阵与成绩记录，以及赛事主办方要求提交的其他必要信息。
              </>,
              <>
                <strong className="font-bold text-slate-800">图片与影像</strong>：你主动上传的赛事照片与封面图片；赛事现场由摄影师或工作人员拍摄并上传的照片；赛事直播中由摄像设备采集的画面与声音。上述内容可能包含你本人或他人的肖像。
              </>,
              <>
                <strong className="font-bold text-slate-800">设备与日志信息</strong>：访问本平台时自动产生的 IP 地址、浏览器类型与版本、操作系统、访问时间、请求地址与响应状态等日志，用于安全防护与故障排查。
              </>,
              <>
                <strong className="font-bold text-slate-800">你主动输入的内容</strong>：使用站内 AI 助手时输入的文本。
              </>,
            ]}
          />
          <p>我们不会收集与你使用本平台无关的个人信息。</p>
        </Section>

        <Section title="二、我们如何使用这些信息">
          <List
            items={[
              '完成账号注册、登录与身份识别，维持会话安全；',
              '处理赛事报名、审核报名信息、编排对阵、记录成绩、生成秩序册与排名；',
              '提供赛事照片墙的浏览、下载，以及赛事直播的观看；',
              '向你发送与赛事相关的通知、提醒、审核结果与公告；',
              '进行安全防护、反垃圾、故障排查、审计与必要的统计分析；',
              '履行法律法规规定的义务，或响应监管部门的合法要求。',
            ]}
          />
        </Section>

        <Section title="三、赛事照片与直播影像">
          <p>
            赛事现场拍摄的照片与直播画面可能包含你的肖像。此类内容默认仅对持有访问链接或经授权的人员开放，并可能加上水印标识。我们不会将包含肖像的内容用于本政策所述目的之外的商业宣传。
          </p>
          <p>
            如果你不希望自己的肖像出现在公开的照片墙或直播画面中，或希望删除某张包含你的照片，可以通过本政策末尾的联系方式提出，我们会在核实身份后及时处理。
          </p>
        </Section>

        <Section title="四、Cookie 与同类技术">
          <p>
            为保持登录状态与会话安全，我们会使用 Cookie 及浏览器本地存储保存必要的会话标识与偏好设置。这些信息仅用于维持服务正常运行，不用于跨站追踪广告。你可以通过浏览器设置清除或拒绝 Cookie，但这可能导致你无法正常登录或使用部分功能。
          </p>
        </Section>

        <Section title="五、信息的共享、转让与公开披露">
          <p>我们不会出售你的个人信息。仅在以下情形下共享必要的信息：</p>
          <List
            items={[
              '已获得你的明确同意；',
              '为提供服务所必需，与本平台的云服务器、邮件发送、直播等基础设施服务商共享必要信息，并要求其承担相应的保密与安全义务；',
              '使用 AI 助手时，你输入的文本会发送至本平台所配置的模型服务商以生成回复；',
              '法律法规规定，或司法机关、行政机关依法提出要求的情形。',
            ]}
          />
          <p>
            我们不会将你的个人信息转让给任何公司、组织或个人，但因合并、收购等原因导致信息转移的除外；届时我们会要求承接方继续受本政策约束。
          </p>
        </Section>

        <Section title="六、信息的存储与保护">
          <List
            items={[
              '本平台部署于中国境内的服务器，你的个人信息存储于境内。',
              '我们采取 HTTPS 加密传输、密码不可逆加密存储、最小权限访问控制、操作日志审计等措施保护你的个人信息。',
              '我们仅在实现本政策所述目的所必需的期限内保留你的个人信息，法律法规另有规定的除外。',
              '互联网环境并非绝对安全。如发生个人信息安全事件，我们将按照法律法规的要求及时告知你，并向主管部门报告。',
            ]}
          />
        </Section>

        <Section title="七、你的权利">
          <p>
            你有权查询、更正、补充、删除你的个人信息，撤回已作出的授权同意，或申请注销账号。你可以通过「账户设置」自行查看和管理部分信息，其他请求可通过本政策末尾的联系方式提出。
          </p>
          <p>
            我们会在核实你的身份后尽快答复，通常不超过 15 个工作日。账号注销后，我们将删除或匿名化处理你的个人信息，法律法规要求保留的除外。
          </p>
        </Section>

        <Section title="八、未成年人保护">
          <p>
            本平台主要面向成年人。若你是不满 14 周岁的未成年人，请在监护人的同意与陪同下使用本平台并提供个人信息。我们不会主动收集未成年人的个人信息，如发现误收集，将及时删除。
          </p>
        </Section>

        <Section title="九、本政策的更新">
          <p>
            我们可能适时修订本政策。修订后的版本将在本页面公布，并更新页面顶部的「更新日期」。涉及重大变更时，我们会通过站内公告等方式另行提示。
          </p>
        </Section>

        <Section title="十、联系我们">
          <p>
            如你对本政策有任何疑问、意见或投诉，或希望行使上述权利，欢迎通过以下方式联系：
          </p>
          <p className="rounded-lg bg-slate-50 px-4 py-3 font-mono text-[13px] text-slate-700">
            邮箱：wulibigger@foxmail.com
          </p>
        </Section>

        <div className="mt-9 border-t border-slate-100 pt-5">
          <Link href="/" className="text-sm font-bold text-blue-700 transition hover:text-blue-900 hover:underline">
            ← 返回首页
          </Link>
        </div>
      </article>
    </PortalFeaturePage>
  );
}
