import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAiConfigDto } from './dto/ai-config.dto';

const DEFAULT_CONFIG_ID = 'default';
const DEFAULT_SYSTEM_PROMPT =
  '你是羽动云赛的 AI 助手，一个羽毛球赛事管理平台的智能客服。请用简洁友好的中文回答用户关于赛事、报名、赛程、规则等问题。';
const DEFAULT_WELCOME_MESSAGE =
  '你好！我是羽动云赛的 AI 小助手，有什么关于赛事的问题可以问我哦。';

const DEFAULT_CONFIG = {
  id: DEFAULT_CONFIG_ID,
  provider: 'openai',
  modelName: 'gpt-4o-mini',
  apiKey: '',
  apiBase: 'https://api.openai.com/v1',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  maxTokens: 2048,
  temperature: 0.7,
  enabled: true,
  welcomeMessage: DEFAULT_WELCOME_MESSAGE,
};

@Injectable()
export class AiConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    const config = await this.getRawConfig();
    const { apiKey, ...rest } = config;
    return {
      ...rest,
      hasApiKey: !!apiKey && apiKey.length > 0,
      apiKeyMasked: this.maskApiKey(apiKey),
    };
  }

  async getPublicConfig() {
    const config = await this.getRawConfig();
    return {
      enabled: config.enabled,
      welcomeMessage: config.welcomeMessage,
    };
  }

  async updateConfig(dto: UpdateAiConfigDto) {
    const data = this.normalizeUpdate(dto);
    await this.prisma.aiConfig.upsert({
      where: { id: DEFAULT_CONFIG_ID },
      create: { ...DEFAULT_CONFIG, ...data },
      update: data,
    });
    return this.getConfig();
  }

  async getRawConfig() {
    const config = await this.prisma.aiConfig.findUnique({
      where: { id: DEFAULT_CONFIG_ID },
    });
    if (config) return config;

    return this.prisma.aiConfig.create({
      data: DEFAULT_CONFIG,
    });
  }

  private normalizeUpdate(dto: UpdateAiConfigDto) {
    const data: Record<string, string | number | boolean> = {};

    if (typeof dto.provider === 'string' && dto.provider.trim()) {
      data.provider = dto.provider.trim();
    }
    if (typeof dto.modelName === 'string' && dto.modelName.trim()) {
      data.modelName = dto.modelName.trim();
    }
    if (typeof dto.apiKey === 'string' && dto.apiKey.trim()) {
      data.apiKey = dto.apiKey.trim();
    }
    if (typeof dto.apiBase === 'string' && dto.apiBase.trim()) {
      data.apiBase = dto.apiBase.trim().replace(/\/+$/, '');
    }
    if (typeof dto.systemPrompt === 'string' && dto.systemPrompt.trim()) {
      data.systemPrompt = dto.systemPrompt.trim();
    }
    if (typeof dto.welcomeMessage === 'string' && dto.welcomeMessage.trim()) {
      data.welcomeMessage = dto.welcomeMessage.trim();
    }
    if (typeof dto.maxTokens === 'number' && Number.isFinite(dto.maxTokens)) {
      data.maxTokens = Math.min(Math.max(Math.round(dto.maxTokens), 256), 8192);
    }
    if (typeof dto.temperature === 'number' && Number.isFinite(dto.temperature)) {
      data.temperature = Math.min(Math.max(dto.temperature, 0), 2);
    }
    if (typeof dto.enabled === 'boolean') {
      data.enabled = dto.enabled;
    }

    return data;
  }

  private maskApiKey(apiKey: string) {
    if (!apiKey) return '';
    if (apiKey.length <= 10) return `${apiKey.slice(0, 2)}****`;
    return `${apiKey.slice(0, 6)}****${apiKey.slice(-4)}`;
  }

  /**
   * Test the LLM connection.
   * If `override` is provided, use those values instead of the saved config
   * (allows testing before saving). Otherwise test against the saved config.
   */
  async testConnection(override?: UpdateAiConfigDto) {
    let apiKey = '';
    let apiBase = '';
    let modelName = '';

    if (override) {
      const norm = this.normalizeUpdate(override);
      apiKey = (norm.apiKey as string) || '';
      apiBase = (norm.apiBase as string) || '';
      modelName = (norm.modelName as string) || '';
    }

    // Fall back to saved config for any missing fields
    const saved = await this.getRawConfig();
    if (!apiKey) apiKey = saved.apiKey;
    if (!apiBase) apiBase = saved.apiBase;
    if (!modelName) modelName = saved.modelName;

    apiBase = apiBase.replace(/\/+$/, '');

    if (!apiKey) {
      return {
        success: false,
        message: '未提供 API Key，无法测试',
        model: modelName,
        provider: override?.provider ?? saved.provider,
      };
    }

    if (!modelName) {
      return {
        success: false,
        message: '未提供模型名称，无法测试',
        model: '',
        provider: override?.provider ?? saved.provider,
      };
    }

    const url = `${apiBase}/chat/completions`;

    try {
      const startMs = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: 'You are a test assistant.' },
            { role: 'user', content: 'Hi, reply with only the word "OK".' },
          ],
          max_tokens: 16,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(15_000), // 15s timeout
      });
      const latencyMs = Date.now() - startMs;

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch {
          /* ignore */
        }

        // Try to extract a useful error message from common API error shapes
        let detail = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(errorBody);
          if (parsed?.error?.message) {
            detail = parsed.error.message;
          } else if (parsed?.message) {
            detail = parsed.message;
          } else if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
            detail = parsed.errors.map((e: { msg?: string }) => e.msg).join('; ');
          }
        } catch {
          /* not JSON, use raw status */
        }

        // Common helpful hints
        let hint = '';
        if (response.status === 401) hint = 'API Key 无效或已过期';
        else if (response.status === 403) hint = '无权限访问该模型，请检查 Key 权限';
        else if (response.status === 404) hint = '模型名称或接口地址有误';
        else if (response.status === 429) hint = '请求频率超限，请稍后重试';
        else if (response.status === 500 || response.status === 502 || response.status === 503)
          hint = '服务商暂时不可用，请稍后重试';

        return {
          success: false,
          message: `${detail}${hint ? ` — ${hint}` : ''}`,
          model: modelName,
          latencyMs,
          provider: override?.provider ?? saved.provider,
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { total_tokens?: number };
      };

      const reply = data.choices?.[0]?.message?.content ?? '';
      const detectedModel = data.model ?? modelName;
      const totalTokens = data.usage?.total_tokens ?? 0;

      return {
        success: true,
        message: '连接成功',
        model: detectedModel,
        reply: reply.trim(),
        latencyMs,
        totalTokens,
        provider: override?.provider ?? saved.provider,
      };
    } catch (err: unknown) {
      let msg = '连接失败';
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        msg = '连接超时（15 秒），请检查 API 地址是否正确及网络是否通畅';
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
        msg = '网络错误，请检查 API 地址是否正确';
      }

      return {
        success: false,
        message: msg,
        model: modelName,
        provider: override?.provider ?? saved.provider,
      };
    }
  }

  /**
   * Fetch available models from the LLM provider's /v1/models endpoint.
   * Uses override values if provided, falls back to saved config.
   */
  async fetchModels(override?: UpdateAiConfigDto) {
    let apiKey = '';
    let apiBase = '';

    if (override) {
      const norm = this.normalizeUpdate(override);
      apiKey = (norm.apiKey as string) || '';
      apiBase = (norm.apiBase as string) || '';
    }

    const saved = await this.getRawConfig();
    if (!apiKey) apiKey = saved.apiKey;
    if (!apiBase) apiBase = saved.apiBase;

    apiBase = apiBase.replace(/\/+$/, '');

    if (!apiKey) {
      return { success: false, message: '未提供 API Key，无法获取模型列表', models: [] };
    }

    if (!apiBase) {
      return { success: false, message: '未提供 API Base URL', models: [] };
    }

    const url = `${apiBase}/models`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const text = await response.text();
          const parsed = JSON.parse(text);
          if (parsed?.error?.message) detail = parsed.error.message;
          else if (parsed?.message) detail = parsed.message;
        } catch {
          /* not JSON */
        }
        if (response.status === 401) detail += ' — API Key 无效或已过期';
        else if (response.status === 404) detail += ' — 该服务商不支持 /models 接口';
        return { success: false, message: detail, models: [] };
      }

      const data = (await response.json()) as {
        data?: Array<{ id: string; object?: string; owned_by?: string }>;
      };

      const models = (data.data ?? [])
        .filter((m) => m.object === 'model' || !m.object)
        .map((m) => m.id)
        .sort();

      if (models.length === 0) {
        return { success: false, message: '未获取到可用模型', models: [] };
      }

      return { success: true, message: `获取到 ${models.length} 个模型`, models };
    } catch (err: unknown) {
      let msg = '获取模型列表失败';
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        msg = '请求超时（10 秒），请检查 API 地址';
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
        msg = '网络错误，请检查 API 地址是否正确';
      }
      return { success: false, message: msg, models: [] };
    }
  }
}
