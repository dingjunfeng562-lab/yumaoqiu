<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

## 图片自动审核

超级管理员（`ROOT`）可从后台“图片审核”菜单或仪表盘“图片审核设置”按钮进入设置页。
配置独立的 DeepSeek API Key，选择是否需要审核并保存。新安装默认关闭，密钥留空保留已保存值。
“测试连接”发送系统生成的测试图片，验证视觉输入和 JSON 输出，不保存配置；调用按服务商规则计费。

启用后，管理员/摄影师赛事照片、赛事封面和水印 Logo 在写文件前统一调用
`deepseek-flash`。只有完整有效的 `PASS` 结果才能继续上传。
`BLOCK`、`REVIEW`、超时、拒答、异常响应均不保存图片，并向上传者返回失败原因。
色情内容及所有二维码均禁止，包括普通微信、群聊、收款和赛事二维码，无安全用途例外。
二维码先由本地 `jsqr` 识别，命中立即拦截；未命中再由 DeepSeek 检查，兼顾无法解码或遮挡的二维码。
模型须同时输出 `hasSexualContent`、`hasQrCode`；任一为真即拦截，即使同时返回 `PASS`。
本版本没有人工复核队列或历史图片重审；关闭后仅影响后续上传。
审核启用时拒绝动图、多页图和超过 8000 万像素的图片；每个后端进程最多并发 3 个审核请求。
密钥仅供后端调用，不返回浏览器，独立于网站 AI 助手配置。

部署时需创建配置表并重新生成 Prisma 客户端，再构建/重启后端。在 `apps/backend` 执行：

```sh
node node_modules/prisma/build/index.js db execute --file prisma/migrations/20260927_image_moderation/migration.sql
node node_modules/prisma/build/index.js generate
node node_modules/typescript/bin/tsc --project tsconfig.build.json --incremental false
```

配置表 SQL 仅创建新表，可重复执行；不使用全库 `db push`。采用 Prisma migrations 管理的部署环境应通过其既有迁移流程应用此迁移。

验证命令（同一目录）：

```sh
node node_modules/jest/bin/jest.js image-moderation --runInBand
node test/image-moderation.smoke.cjs
```

冒烟检查要求本地后端运行于 4000 端口，创建并清理专属测试账号，不修改已保存的审核设置。
若已有密钥，检查会调用一次真实图片审核；`--skip-live` 跳过该调用。
可选 `--browser` 使用仓库本地 Playwright 和 Edge 验证 3000 端口页面并保存截图。
