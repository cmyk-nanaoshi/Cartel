// Configuration lue uniquement côté serveur. Aucune clé secrète n'est envoyée au client.

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export type ProviderName = 'anthropic' | 'openai' | 'demo';

export function loadConfig() {
  const requested = str('AI_PROVIDER', '').toLowerCase();
  let provider: ProviderName;
  if (requested === 'anthropic' || requested === 'openai' || requested === 'demo') provider = requested;
  else if (str('ANTHROPIC_API_KEY')) provider = 'anthropic';
  else if (str('OPENAI_API_KEY')) provider = 'openai';
  else provider = 'demo';

  return {
    provider,
    anthropic: {
      apiKey: str('ANTHROPIC_API_KEY'),
      baseUrl: str('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
      visionModel: str('ANTHROPIC_VISION_MODEL', 'claude-sonnet-5-5'),
      textModel: str('ANTHROPIC_TEXT_MODEL', 'claude-sonnet-5-5'),
      chatModel: str('ANTHROPIC_CHAT_MODEL', 'claude-haiku-5-5'),
      labelModel: str('ANTHROPIC_LABEL_MODEL', 'claude-haiku-5-5')
    },
    openai: {
      apiKey: str('OPENAI_API_KEY'),
      baseUrl: str('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      visionModel: str('OPENAI_VISION_MODEL', 'gpt-4o'),
      textModel: str('OPENAI_TEXT_MODEL', 'gpt-4o'),
      chatModel: str('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),
      labelModel: str('OPENAI_LABEL_MODEL', 'gpt-4o-mini')
    },
    sources: {
      offline: str('SOURCES_OFFLINE') === '1',
      disabled: str('SOURCES_DISABLED')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      smithsonianKey: str('SMITHSONIAN_API_KEY'),
      jocondeBase: str(
        'JOCONDE_API_BASE',
        'https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-joconde-extrait/records'
      ),
      contact: str('CONTACT_EMAIL', 'contact@example.org'),
      timeoutMs: num('SOURCES_TIMEOUT_MS', 7000)
    },
    limits: {
      perMinute: num('RATE_LIMIT_PER_MINUTE', 12),
      dailyBudgetUsd: num('DAILY_BUDGET_USD', 2),
      maxImageBytes: num('MAX_IMAGE_BYTES', 4 * 1024 * 1024)
    },
    accessCode: str('APP_ACCESS_CODE'),
    cacheDir: str('CACHE_DIR', '.cache'),
    port: num('PORT', 8787)
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
