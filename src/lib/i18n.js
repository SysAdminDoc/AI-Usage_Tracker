const ENGLISH = Object.freeze({
  'provider.claude': 'Claude', 'provider.codex': 'Codex',
  'provider.anthropic-api': 'Anthropic API', 'provider.openai-api': 'OpenAI API',
  'overview.mostConstrained': 'Most constrained', 'overview.used': '{percent} used',
  'overview.localOnly': 'Local only', 'updated.never': 'Never updated',
  'updated.prefix': 'Updated {relative}', 'empty.title': 'No local usage snapshot yet',
  'empty.body': 'Open a signed-in usage page once. The tracker stores the reading locally, then this dashboard stays useful all day.',
  'empty.openClaude': 'Open Claude', 'empty.openCodex': 'Open Codex',
  'error.provider': '{provider} refresh failed', 'error.recovery': 'Open the provider page and try refresh again.',
  'status.stale': 'Stale ({relative})', 'status.staleShort': 'Stale', 'status.localOnly': 'Local only',
  'settings.language': 'Language', 'settings.languageHint': 'Dashboard labels and dates use this locale.',
  'language.en': 'English', 'language.es': 'Spanish', 'language.fr': 'French', 'language.de': 'German',
});

const TRANSLATIONS = Object.freeze({
  en: ENGLISH,
  es: {
    'overview.mostConstrained': 'Más limitado', 'overview.used': '{percent} usado', 'overview.localOnly': 'Solo local',
    'updated.never': 'Nunca actualizado', 'updated.prefix': 'Actualizado {relative}', 'empty.title': 'Aún no hay datos de uso local',
    'empty.body': 'Abre una página de uso con sesión iniciada una vez. El dato se guarda localmente y este panel seguirá disponible.',
    'empty.openClaude': 'Abrir Claude', 'empty.openCodex': 'Abrir Codex', 'error.provider': 'Falló la actualización de {provider}',
    'error.recovery': 'Abre la página del proveedor e inténtalo de nuevo.', 'status.stale': 'Obsoleto ({relative})', 'status.staleShort': 'Obsoleto',
    'status.localOnly': 'Solo local', 'settings.language': 'Idioma', 'settings.languageHint': 'Las etiquetas y fechas usan este idioma.',
    'language.en': 'Inglés', 'language.es': 'Español', 'language.fr': 'Francés', 'language.de': 'Alemán',
  },
  fr: {
    'overview.mostConstrained': 'Plus contraint', 'overview.used': '{percent} utilisé', 'overview.localOnly': 'Local uniquement',
    'updated.never': 'Jamais mis à jour', 'updated.prefix': 'Mis à jour {relative}', 'empty.title': 'Aucun instantané local',
    'empty.body': 'Ouvrez une page d’utilisation connectée. La lecture est conservée localement pour rester disponible.',
    'empty.openClaude': 'Ouvrir Claude', 'empty.openCodex': 'Ouvrir Codex', 'error.provider': 'Échec de l’actualisation de {provider}',
    'error.recovery': 'Ouvrez la page du fournisseur et réessayez.', 'status.stale': 'Périmé ({relative})', 'status.staleShort': 'Périmé',
    'status.localOnly': 'Local uniquement', 'settings.language': 'Langue', 'settings.languageHint': 'Les libellés et les dates utilisent cette langue.',
    'language.en': 'Anglais', 'language.es': 'Espagnol', 'language.fr': 'Français', 'language.de': 'Allemand',
  },
  de: {
    'overview.mostConstrained': 'Am stärksten begrenzt', 'overview.used': '{percent} verwendet', 'overview.localOnly': 'Nur lokal',
    'updated.never': 'Noch nie aktualisiert', 'updated.prefix': 'Aktualisiert {relative}', 'empty.title': 'Noch kein lokaler Nutzungsstand',
    'empty.body': 'Öffne einmal eine angemeldete Nutzungsseite. Der Wert bleibt lokal und ist danach jederzeit verfügbar.',
    'empty.openClaude': 'Claude öffnen', 'empty.openCodex': 'Codex öffnen', 'error.provider': 'Aktualisierung von {provider} fehlgeschlagen',
    'error.recovery': 'Öffne die Anbieterseite und versuche es erneut.', 'status.stale': 'Veraltet ({relative})', 'status.staleShort': 'Veraltet',
    'status.localOnly': 'Nur lokal', 'settings.language': 'Sprache', 'settings.languageHint': 'Beschriftungen und Datumsangaben verwenden diese Sprache.',
    'language.en': 'Englisch', 'language.es': 'Spanisch', 'language.fr': 'Französisch', 'language.de': 'Deutsch',
  },
});

export const SUPPORTED_LOCALES = Object.freeze(['en', 'es', 'fr', 'de']);

export function resolveLocale(locale) {
  const normalized = String(locale || '').toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : 'en';
}

export function localeLabel(locale) {
  const language = resolveLocale(locale);
  return ENGLISH[`language.${language}`];
}

export function createI18n(locale = 'en') {
  const language = resolveLocale(locale);
  const table = { ...ENGLISH, ...(TRANSLATIONS[language] || {}) };
  const intlLocale = language === 'en' ? 'en-US' : language;
  const dateTime = new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium', timeStyle: 'short' });
  const relative = typeof Intl.RelativeTimeFormat === 'function'
    ? new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' }) : null;
  return {
    locale: language,
    t(key, variables = {}) {
      const template = table[key] || ENGLISH[key] || key;
      return template.replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? `{${name}}`));
    },
    formatPercent(value, maximumFractionDigits = 0) {
      const percent = new Intl.NumberFormat(intlLocale, { style: 'percent', maximumFractionDigits });
      return percent.format(Math.max(0, Math.min(100, Number(value) || 0)) / 100);
    },
    formatDateTime(iso) {
      const date = new Date(iso);
      return Number.isFinite(date.getTime()) ? dateTime.format(date) : '—';
    },
    formatRelative(iso) {
      const ms = Date.now() - new Date(iso).getTime();
      if (!Number.isFinite(ms)) return '—';
      const minutes = Math.round(Math.abs(ms) / 60_000);
      if (!relative) return `${minutes}m`;
      if (minutes < 60) return relative.format(ms <= 0 ? minutes : -minutes, 'minute');
      const hours = Math.round(minutes / 60);
      if (hours < 24) return relative.format(ms <= 0 ? hours : -hours, 'hour');
      const days = Math.round(hours / 24);
      return relative.format(ms <= 0 ? days : -days, 'day');
    },
  };
}
