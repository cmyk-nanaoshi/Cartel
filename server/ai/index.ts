import type { AppConfig } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { DemoProvider } from './demo.js';
import { OpenAICompatibleProvider } from './openai.js';
import type { AIProvider } from './types.js';

export function createProvider(cfg: AppConfig): AIProvider {
  if (cfg.provider === 'anthropic') {
    const a = cfg.anthropic;
    return new AnthropicProvider(a.apiKey, a.baseUrl, {
      vision: a.visionModel,
      text: a.textModel,
      chat: a.chatModel,
      label: a.labelModel
    });
  }
  if (cfg.provider === 'openai') {
    const o = cfg.openai;
    return new OpenAICompatibleProvider(o.apiKey, o.baseUrl, {
      vision: o.visionModel,
      text: o.textModel,
      chat: o.chatModel,
      label: o.labelModel
    });
  }
  return new DemoProvider();
}
