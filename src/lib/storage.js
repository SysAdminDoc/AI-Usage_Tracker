// Unified storage seam. Routes to chrome.storage.local in extensions or
// GM.* in userscripts. Falls back to localStorage when nothing else exists
// (e.g. in unit tests).

const STORE_KEY = 'aut.state.v1';

const adapter = pickAdapter();

function pickAdapter() {
  // 1) WebExtensions (Chrome + Firefox MV3 expose browser/chrome.storage).
  const ext = (typeof browser !== 'undefined' && browser.storage)
    || (typeof chrome !== 'undefined' && chrome.storage);
  if (ext && ext.local) {
    return {
      type: 'webext',
      async get(key) {
        const r = await ext.local.get(key);
        return r[key];
      },
      async set(key, value) {
        await ext.local.set({ [key]: value });
      },
    };
  }

  // 2) Userscript managers.
  if (typeof GM !== 'undefined' && GM.setValue) {
    return {
      type: 'gm',
      async get(key) {
        const raw = await GM.getValue(key, null);
        return raw ? JSON.parse(raw) : null;
      },
      async set(key, value) {
        await GM.setValue(key, JSON.stringify(value));
      },
    };
  }
  if (typeof GM_setValue === 'function') {
    return {
      type: 'gm-legacy',
      async get(key) {
        const raw = GM_getValue(key, null);
        return raw ? JSON.parse(raw) : null;
      },
      async set(key, value) {
        GM_setValue(key, JSON.stringify(value));
      },
    };
  }

  // 3) DOM localStorage fallback.
  return {
    type: 'localstorage',
    async get(key) {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, value) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(value));
      }
    },
  };
}

export const storageType = adapter.type;

export async function loadState() {
  return (await adapter.get(STORE_KEY)) || defaultState();
}

export async function saveState(state) {
  await adapter.set(STORE_KEY, state);
}

export async function patchState(patch) {
  const state = await loadState();
  const next = { ...state, ...patch };
  await saveState(next);
  return next;
}

export function defaultState() {
  return {
    snapshot: { fetchedAtISO: null, providers: { claude: null, codex: null } },
    history: [],          // [{ ts, bucketId, percentUsed }]
    firedRules: {},       // { '<provider>-<bucket>-<rule>-<resetISO>': true }
    settings: defaultSettings(),
    widget: { x: null, y: null, minimized: false },
  };
}

export function defaultSettings() {
  return {
    refreshMinutes: 5,
    silentTabRefresh: false,
    showProviders: { claude: true, codex: true },
    showRows: {     // headline buckets default ON; per-model rows default OFF
      'claude-session': true,
      'claude-weekly-all': true,
      'claude-weekly-sonnet': false,
      'claude-weekly-design': false,
      'codex-5h-all': true,
      'codex-weekly-all': true,
    },
    notifications: {
      'R1-60': true,
      'R1-15': true,
      'R1-0': true,
      'R2':    true,
      'U1-75': false,
      'U1-90': true,
      'U1-95': true,
      'U2':    true,
      'D1':    true,
      dailyBriefingHour: 8,    // 24h local
    },
    theme: 'mocha',            // 'mocha' (default) | 'mocha-light' (v0.2+)
  };
}
