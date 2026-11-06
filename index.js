/**
 * @local/zai-usage-ring — host half.
 *
 * Registers one exact Fetch route on Connection's authenticated `/api`
 * channel (`POST /api/zai-usage-ring/usage`). The browser half calls it
 * through `ctx.connection.rpc.call`, so the route answers the standard
 * `{type:'client-request', rpcId, method, payload}` envelope with a
 * `{type:'server-response', rpcId, result}` reply. Connection owns the
 * trusted-host + browser-session fence in front of this route.
 *
 * On each request the host half resolves the Z.AI / GLM Coding Plan API key
 * through the Harness credential service (the key never reaches the
 * browser), queries the plan's quota-limit monitor endpoint, and ships only
 * a normalized JSON view (usage windows, percentages, reset timestamps).
 *
 * API shape (cross-checked with community research, glm-plan-usage2
 * docs/api-research.md and dsh-quota-panel's zai-coding-quota adapter):
 *   GET {site}/api/monitor/usage/quota/limit   Authorization: Bearer <key>
 *   { code: 200, data: { limits: [...], level: 'lite' } }
 * with limit rows:
 *   TOKENS_LIMIT  unit=3 -> 5-hour window, unit=6 -> weekly pool
 *                 (credit packages may declare the same units as
 *                 CREDIT_LIMIT; percentage is authoritative)
 *   TIME_LIMIT    MCP/tool-call monthly lane with usage (total),
 *                 currentValue (used), usageDetails per tool
 * and `nextResetTime` as a millisecond epoch on every row.
 */

export const inject = ['connection', 'credentials'];

/** Shared API channel and the method this plugin owns on it. */
const CHANNEL = '/api';
const METHOD = 'zai-usage-ring/usage';
const ROUTE_PATH = `${CHANNEL}/${METHOD}`;

/** Quota-limit monitor endpoint per site. */
const SITES = {
  global: 'https://api.z.ai/api/monitor/usage/quota/limit',
  cn: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
};

/** Credential ref probed per site during auto-discovery (order = priority). */
const SITE_REFS = {
  global: ['ZAI_API_KEY', 'GLM_CODING_API_KEY'],
  cn: ['ZAI_CODING_CN_API_KEY', 'ZHIPU_CODING_API_KEY'],
};

/** TOKENS_LIMIT/CREDIT_LIMIT `unit` -> semantic window. */
const TOKEN_UNIT_WINDOW = { 3: 'fiveHour', 6: 'weekly' };

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function fail(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

/**
 * Resolve which site to query and the bearer key for it.
 * @param ctx - plugin context with the credentials service.
 * @param config - row config (`site`, `credential`, `apiKey`).
 * @returns `{site, key, ref}` or `{error}`.
 */
async function resolveTarget(ctx, config) {
  const literal = str(config.apiKey);
  const explicitRef = str(config.credential);
  const siteSetting = str(config.site) ?? 'auto';

  if (literal) {
    const site = siteSetting !== 'auto' ? siteSetting
      : explicitRef && /CN/i.test(explicitRef) ? 'cn' : 'global';
    return { site, key: literal, ref: explicitRef ?? 'config.apiKey' };
  }

  const probeOrder = siteSetting === 'global' ? ['global']
    : siteSetting === 'cn' ? ['cn']
      : ['global', 'cn'];

  if (explicitRef) {
    const hit = await ctx.credentials.resolve(explicitRef);
    if (hit && typeof hit.value === 'string' && hit.value.length > 0) {
      const site = siteSetting !== 'auto' ? siteSetting
        : /CN/i.test(explicitRef) ? 'cn' : 'global';
      return { site, key: hit.value, ref: explicitRef };
    }
    return { error: `credential "${explicitRef}" is not configured (set it in $DSH_HOME/.credentials.yaml or the environment)` };
  }

  for (const site of probeOrder) {
    for (const ref of SITE_REFS[site]) {
      const hit = await ctx.credentials.resolve(ref);
      if (hit && typeof hit.value === 'string' && hit.value.length > 0) {
        return { site, key: hit.value, ref };
      }
    }
  }
  return { error: 'no Z.AI coding-plan key configured: set ZAI_CODING_CN_API_KEY (open.bigmodel.cn) or ZAI_API_KEY (api.z.ai) in $DSH_HOME/.credentials.yaml or the environment, or set credential/apiKey in this plugin\'s config' };
}

/**
 * Map one upstream limit row to a normalized window record.
 * Returns null for rows that carry no recognizable meaning.
 */
function windowOfLimit(limit) {
  const type = limit.type;
  if (type === 'TIME_LIMIT') {
    const used = num(limit.currentValue);
    const total = num(limit.usage);
    const pct = num(limit.percentage);
    const percentage = pct !== null && pct >= 0 ? Math.min(100, pct)
      : used !== null && total !== null && total > 0 ? Math.round((used / total) * 100)
        : null;
    const details = Array.isArray(limit.usageDetails)
      ? limit.usageDetails
        .filter(isRecord)
        .map((item) => ({ code: str(item.modelCode) ?? '', usage: num(item.usage) ?? 0 }))
        .filter((item) => item.code !== '')
      : null;
    return {
      id: 'mcp',
      kind: 'counts',
      percentage,
      used,
      total,
      remaining: num(limit.remaining),
      resetAt: num(limit.nextResetTime),
      details,
    };
  }
  if (type === 'TOKENS_LIMIT' || type === 'CREDIT_LIMIT') {
    const id = TOKEN_UNIT_WINDOW[limit.unit] ?? null;
    if (!id) return { deferred: true, limit };
    return {
      id,
      kind: 'tokens',
      percentage: num(limit.percentage),
      used: num(limit.currentValue),
      total: num(limit.usage),
      remaining: num(limit.remaining),
      resetAt: num(limit.nextResetTime),
      details: null,
    };
  }
  return null;
}

/**
 * Normalize the upstream `limits` array into the widget's window list:
 * fiveHour / weekly / mcp, each with percentage, counts, reset timestamp.
 * Token-kind rows without a known unit keep the reset-order fallback
 * (earliest reset fills the 5-hour lane, next fills the weekly pool).
 */
function normalizeLimits(limits) {
  const windows = [];
  const deferred = [];
  for (const limit of Array.isArray(limits) ? limits : []) {
    if (!isRecord(limit)) continue;
    const result = windowOfLimit(limit);
    if (!result) continue;
    if (result.deferred) { deferred.push(result.limit); continue; }
    if (!windows.some((w) => w.id === result.id)) windows.push(result);
  }
  deferred.sort((a, b) => (num(a.nextResetTime) ?? Infinity) - (num(b.nextResetTime) ?? Infinity));
  for (const slot of ['fiveHour', 'weekly']) {
    if (windows.some((w) => w.id === slot)) continue;
    const limit = deferred.shift();
    if (!limit) break;
    windows.push({
      id: slot,
      kind: 'tokens',
      percentage: num(limit.percentage),
      used: num(limit.currentValue),
      total: num(limit.usage),
      remaining: num(limit.remaining),
      resetAt: num(limit.nextResetTime),
      details: null,
    });
  }
  const order = ['fiveHour', 'weekly', 'mcp'];
  windows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return windows;
}

/**
 * Query the configured site once and return the normalized view (or a
 * typed failure the widget can render).
 */
async function fetchUsage(ctx, config, signal) {
  const target = await resolveTarget(ctx, config);
  if (target.error) return fail('credential', target.error);

  const timeoutMs = num(config.timeoutMs) ?? 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return fail('cancelled', 'request cancelled'); }
    signal.addEventListener('abort', abort, { once: true });
  }
  let response;
  let text;
  try {
    response = await fetch(SITES[target.site], {
      headers: { authorization: `Bearer ${target.key}`, accept: 'application/json' },
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? `upstream request timed out after ${timeoutMs}ms`
      : String((error && error.message) || error);
    return fail('network', message);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }

  if (response.status === 401 || response.status === 403) {
    return fail('auth', `upstream rejected the key (HTTP ${response.status}) — check ${target.ref}`);
  }
  if (!response.ok) {
    return fail('upstream', `upstream HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail('upstream', 'upstream returned non-JSON body');
  }
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (!data) return fail('upstream', 'upstream response missing data.limits');
  if (num(body.code) !== null && body.code !== 200) {
    return fail('upstream', `upstream code ${String(body.code)}: ${str(body.msg) ?? 'unknown error'}`);
  }
  const windows = normalizeLimits(data.limits);
  if (windows.length === 0) return fail('upstream', 'upstream reported no usage windows');
  return {
    ok: true,
    value: {
      site: target.site,
      ref: target.ref,
      level: str(data.level),
      windows,
      fetchedAt: Date.now(),
      refreshMs: num(config.refreshMs) ?? 60000,
    },
  };
}

/** Success/error result envelope Connection's client validates. */
function rpcEnvelope(rpcId, result, status = 200) {
  return new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Serve one request: validate the client-request envelope, dispatch to the
 * single endpoint, mirror cancellations from the request signal.
 */
async function serve(request, config, ctx) {
  const contentType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return rpcEnvelope('?', fail('gateway/bad-request', 'content type must be application/json'), 415);
  }
  let message;
  try {
    message = await request.json();
  } catch {
    return rpcEnvelope('?', fail('gateway/bad-request', 'body is not JSON'), 400);
  }
  if (!isRecord(message) || message.type !== 'client-request' || typeof message.rpcId !== 'string') {
    return rpcEnvelope('?', fail('gateway/bad-request', 'invalid client-request message'), 400);
  }
  if (message.method !== METHOD) {
    return rpcEnvelope(message.rpcId, fail('gateway/bad-request', `method ${JSON.stringify(String(message.method))} does not match endpoint ${JSON.stringify(METHOD)}`));
  }
  try {
    return rpcEnvelope(message.rpcId, await fetchUsage(ctx, config, request.signal));
  } catch (error) {
    return rpcEnvelope(message.rpcId, fail('internal', String((error && error.message) || error)));
  }
}

/**
 * Apply the plugin: mount the `/api` route for the usage endpoint.
 * Route registrations belong to this plugin's fiber and are disposed with it.
 */
export function apply(ctx, config = {}) {
  ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => serve(request, config, ctx),
  });

  // ── TEMPORARY DIAGNOSTIC ROUTE (remove after debugging) ─────────────
  // Plain webServer route (no auth fence) so a shell curl can inspect why
  // the browser half is not visible: client-module graph membership,
  // credential resolution state, and browser-side beacons (?beacon=stage)
  // that mark how far the client module got. Leaks no secret value.
  const BEACONS = [];
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/zai-usage-ring-debug',
      handler: (req, res) => {
        const url = new URL(req.url, 'http://dsh.invalid');
        const stage = url.searchParams.get('beacon');
        if (stage !== null) {
          BEACONS.push({ stage, at: new Date().toISOString() });
          if (BEACONS.length > 60) BEACONS.shift();
          res.writeHead(204, { 'cache-control': 'no-store' });
          res.end();
          return;
        }
        const out = { time: new Date().toISOString(), node: process.version };
        try {
          const cm = webCtx.get('clientModules');
          out.clientModulesAvailable = cm !== undefined && cm !== null;
          if (cm) {
            const graph = cm.graph();
            const entries = Array.isArray(graph.entries) ? graph.entries : [];
            out.graphEntryIds = entries.map((e) => e && e.id);
            out.graphRelease = graph.release;
            out.myEntry = entries.find((e) => e && e.id === '@local/zai-usage-ring') ?? null;
            out.clientPath = cm.clientPath('@local/zai-usage-ring') ?? null;
          }
        } catch (error) {
          out.graphError = String((error && error.message) || error);
        }
        void (async () => {
          try {
            const probes = {};
            for (const refs of Object.values(SITE_REFS)) {
              for (const ref of refs) {
                const hit = await ctx.credentials.resolve(ref);
                probes[ref] = hit && typeof hit.value === 'string' && hit.value.length > 0;
              }
            }
            out.credentialResolved = probes;
          } catch (error) {
            out.credentialError = String((error && error.message) || error);
          }
          out.beacons = BEACONS.slice().reverse();
          const body = JSON.stringify(out, null, 2);
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(body);
        })();
      },
    }));
  });
}
