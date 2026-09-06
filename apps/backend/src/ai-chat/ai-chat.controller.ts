import { Controller, Post, Body, Get, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AiChatService } from './ai-chat.service';
import { AiChatRequestDto } from './dto/ai-chat.dto';
import { UsageMetricsService } from '../usage-metrics/usage-metrics.service';

@Controller('ai-chat')
export class AiChatController {
  constructor(
    private readonly aiChatService: AiChatService,
    private readonly usageMetricsService: UsageMetricsService,
  ) {}

  @Get('settings')
  async getSettings() {
    return this.aiChatService.getPublicSettings();
  }

  @Post()
  async chat(@Body() dto: AiChatRequestDto) {
    return this.aiChatService.chat(dto);
  }

  /**
   * SSE streaming chat endpoint.
   * Writes SSE chunks directly to res with immediate flush for low latency.
   */
  @Post('stream')
  async chatStream(@Body() dto: AiChatRequestDto, @Res() res: Response) {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Disable compression middleware buffering (e.g. compression package)
    res.setHeader('Content-Encoding', 'identity');
    // Initial SSE comment to establish the stream immediately
    res.write(':ok\n\n');
    // flushHeaders sends the status line + headers to the client NOW
    res.flushHeaders();

    try {
      const config = await this.aiChatService.getRawConfigForStream();

      if (!config.enabled) {
        this.sendSse(res, { type: 'error', text: 'AI 助手暂未开放，请稍后再试。' });
        res.end();
        return;
      }

      if (!config.apiKey) {
        this.sendSse(res, { type: 'error', text: 'AI 服务未配置 API Key，请联系管理员。' });
        res.end();
        return;
      }

      const apiBase = config.apiBase.replace(/\/+$/, '');
      const url = `${apiBase}/chat/completions`;
      const systemPrompt = config.systemPrompt || '你是羽动云赛的 AI 助手，一个羽毛球赛事管理平台的智能客服。请用简洁友好的中文回答用户关于赛事、报名、赛程、规则等问题。';
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...dto.messages.slice(-24),
      ];

      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.modelName,
          messages,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream: true,
          // Enable thinking for providers that support it
          chat_template_kwargs: { enable_thinking: true },
        }),
      });

      if (!upstream.ok) {
        const errorText = await upstream.text().catch(() => '');
        this.sendSse(res, { type: 'error', text: `AI 服务请求失败 (${upstream.status})，请检查后台配置。${errorText ? ` ${errorText}` : ''}` });
        res.end();
        return;
      }

      if (!upstream.body) {
        this.sendSse(res, { type: 'error', text: 'AI 服务未返回流式数据。' });
        res.end();
        return;
      }

      void this.usageMetricsService.trackAiChat().catch((error) => {
        console.error('Failed to track AI chat usage:', error);
      });

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          this.sendSse(res, { type: 'done' });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) return;

          if (delta.reasoning_content) {
            this.sendSse(res, { type: 'thinking', text: delta.reasoning_content });
          }
          if (delta.thinking_content) {
            this.sendSse(res, { type: 'thinking', text: delta.thinking_content });
          }
          if (Array.isArray(delta.content)) {
            for (const block of delta.content) {
              if (block.type === 'thinking' && block.thinking) {
                this.sendSse(res, { type: 'thinking', text: block.thinking });
              } else if (block.type === 'text' && block.text) {
                this.sendSse(res, { type: 'content', text: block.text });
              }
            }
            return;
          }
          if (delta.content) {
            this.sendSse(res, { type: 'content', text: delta.content });
          }
        } catch {
          // skip non-JSON
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          processLine(line.trim());
        }
      }
      // Process remaining buffer
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          processLine(line.trim());
        }
      }

      res.end();
    } catch (error) {
      console.error('SSE stream error:', error);
      try {
        this.sendSse(res, { type: 'error', text: 'AI 流式响应中断，请重试。' });
        res.end();
      } catch {
        // response already ended
      }
    }
  }

  private sendSse(res: Response, chunk: { type: string; text?: string }) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    // Force-flush the kernel socket buffer so the client receives data immediately.
    // flushHeaders() only works for the first call; for subsequent writes we need
    // the Node.js native .flush() method on the underlying socket.
    const sock = (res as unknown as { socket?: { writable?: boolean; flush?: () => void; destroy?: () => void } }).socket;
    if (sock?.writable && typeof sock.flush === 'function') {
      sock.flush();
    }
  }
}
