import { BadRequestException, Injectable } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { AiChatRequestDto } from './dto/ai-chat.dto';
import { Readable } from 'stream';
import { UsageMetricsService } from '../usage-metrics/usage-metrics.service';

export interface SseChunk {
  type: 'thinking' | 'content' | 'done' | 'error';
  text?: string;
  model?: string;
}

@Injectable()
export class AiChatService {
  constructor(
    private readonly aiConfigService: AiConfigService,
    private readonly usageMetricsService: UsageMetricsService,
  ) {}

  async getPublicSettings() {
    return this.aiConfigService.getPublicConfig();
  }

  /**
   * Non-streaming chat (kept for backwards compatibility / fallback).
   */
  async chat(dto: AiChatRequestDto) {
    const config = await this.aiConfigService.getRawConfig();

    if (!config.enabled) {
      throw new BadRequestException('AI 助手暂未开放，请稍后再试。');
    }

    if (!config.apiKey) {
      throw new BadRequestException('AI 服务未配置 API Key，请联系管理员。');
    }

    const reply = await this.requestChatCompletion(config, dto);
    void this.usageMetricsService.trackAiChat().catch((error) => {
      console.error('Failed to track AI chat usage:', error);
    });
    return { reply };
  }

  /** Get raw config (with full apiKey) for controller-level SSE streaming */
  async getRawConfigForStream() {
    return this.aiConfigService.getRawConfig();
  }

  /**
   * SSE streaming chat (legacy — kept as fallback).
   */
  async chatStream(dto: AiChatRequestDto): Promise<Readable> {
    const config = await this.aiConfigService.getRawConfig();

    if (!config.enabled) {
      const r = new Readable();
      r.push(this.formatSse({ type: 'error', text: 'AI 助手暂未开放，请稍后再试。' }));
      r.push(null);
      return r;
    }

    if (!config.apiKey) {
      const r = new Readable();
      r.push(this.formatSse({ type: 'error', text: 'AI 服务未配置 API Key，请联系管理员。' }));
      r.push(null);
      return r;
    }

    const apiBase = config.apiBase.replace(/\/+$/, '');
    const url = `${apiBase}/chat/completions`;
    const messages = [
      { role: 'system' as const, content: config.systemPrompt },
      ...dto.messages.slice(-24),
    ];

    return this.streamRequest(url, config.apiKey, config.modelName, messages, config.maxTokens, config.temperature);
  }

  private async streamRequest(
    url: string,
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
    temperature: number,
  ): Promise<Readable> {
    const stream = new Readable({ read() {} });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: true,
          // Enable thinking for providers that support it (e.g. Agnes AI, DeepSeek)
          chat_template_kwargs: { enable_thinking: true },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        stream.push(this.formatSse({ type: 'error', text: `AI 服务请求失败 (${response.status})，请检查后台配置。${errorText ? ` ${errorText}` : ''}` }));
        stream.push(null);
        return stream;
      }

      if (!response.body) {
        stream.push(this.formatSse({ type: 'error', text: 'AI 服务未返回流式数据。' }));
        stream.push(null);
        return stream;
      }

      // Parse SSE from the upstream LLM
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Detect thinking field names from different providers
      let thinkingDetected = false;

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          stream.push(this.formatSse({ type: 'done' }));
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) return;

          // --- OpenAI-compatible reasoning_content (DeepSeek, etc.) ---
          if (delta.reasoning_content) {
            thinkingDetected = true;
            stream.push(this.formatSse({ type: 'thinking', text: delta.reasoning_content }));
          }

          // --- Agnes AI / Anthropic-style thinking ---
          if (delta.thinking_content) {
            thinkingDetected = true;
            stream.push(this.formatSse({ type: 'thinking', text: delta.thinking_content }));
          }

          // --- Anthropic extended format: content blocks with type "thinking" ---
          if (Array.isArray(delta.content)) {
            for (const block of delta.content) {
              if (block.type === 'thinking' && block.thinking) {
                thinkingDetected = true;
                stream.push(this.formatSse({ type: 'thinking', text: block.thinking }));
              } else if (block.type === 'text' && block.text) {
                stream.push(this.formatSse({ type: 'content', text: block.text }));
              }
            }
            return;
          }

          // --- Standard content ---
          if (delta.content) {
            stream.push(this.formatSse({ type: 'content', text: delta.content }));
          }
        } catch {
          // Non-JSON data line, skip
        }
      };

      const pump = async () => {
        try {
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
          if (!thinkingDetected) {
            // If we never detected thinking, that's fine — emit done
            stream.push(this.formatSse({ type: 'done' }));
          }
          stream.push(null);
        } catch (err) {
          console.error('SSE stream error:', err);
          stream.push(this.formatSse({ type: 'error', text: 'AI 流式响应中断，请重试。' }));
          stream.push(null);
        }
      };

      pump().catch((err) => {
        console.error('SSE pump error:', err);
        stream.push(this.formatSse({ type: 'error', text: 'AI 流式响应出错。' }));
        stream.push(null);
      });
    } catch (error) {
      stream.push(this.formatSse({ type: 'error', text: 'AI 服务连接异常，请稍后再试。' }));
      stream.push(null);
    }

    return stream;
  }

  private formatSse(chunk: SseChunk): string {
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  /**
   * Non-streaming fallback (used by the old POST /ai-chat endpoint).
   */
  private async requestChatCompletion(
    config: Awaited<ReturnType<AiConfigService['getRawConfig']>>,
    dto: AiChatRequestDto,
  ) {
    const apiBase = config.apiBase.replace(/\/+$/, '');
    const url = `${apiBase}/chat/completions`;
    const messages = [
      { role: 'system' as const, content: config.systemPrompt },
      ...dto.messages.slice(-24),
    ];

    try {
      const response = await fetch(url, {
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
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`AI API error (${response.status}): ${errorText}`);
        throw new BadRequestException(
          `AI 服务请求失败 (${response.status})，请检查后台配置。`,
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content?.trim() || '抱歉，AI 暂时无法回复。';
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('AI chat error:', error);
      throw new BadRequestException('AI 服务连接异常，请稍后再试。');
    }
  }
}
