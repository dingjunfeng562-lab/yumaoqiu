// 图片审核与报名表识别共用的识图通道（OpenAI 兼容的 chat/completions）。
// 只有服务端使用，API Key 存在 ImageModerationConfig 里，由超级管理员维护。
export const VISION_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const VISION_MODEL = 'deepseek-flash';
