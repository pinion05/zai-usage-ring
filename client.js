/**
 * @local/zai-usage-ring — client half (browser bundle).
 *
 * Floating widget in the `shell.overlay` slot: a small fixed bottom-right
 * capsule with a circular gauge of the highest usage window; clicking it
 * expands a card with one circular gauge per plan window (5-hour rolling,
 * weekly pool, MCP/tool monthly lane), each showing the used percentage,
 * used/total counts where the API reports them, and the reset time both as
 * a live countdown and an absolute local timestamp.
 *
 * Data arrives over the loopback Connection RPC channel `/api` owned by the
 * host half in index.js (`POST /api/zai-usage-ring/usage`); the API key
 * never reaches the browser. Styled exclusively with the Harness design
 * tokens (`--dsw-alias-*`, `--dsw-font-*`) with fallbacks, so the widget
 * follows the product theme (light/dark).
 */
// TEMPORARY DIAGNOSTIC (remove after debugging): report how far this module
// gets to the host half's /zai-usage-ring-debug route.
function __zaiBeacon(stage) {
	try {
		fetch('/zai-usage-ring-debug?beacon=' + encodeURIComponent(stage), { cache: 'no-store' });
	} catch (e) { /* beacon is best-effort */ }
}
__zaiBeacon('script');

window.__ModuleLoader__.load({
	id: '@local/zai-usage-ring',
	factory: (require) => {
		__zaiBeacon('factory');
		const React = require('react');
		const h = React.createElement;

		const CHANNEL = '/api';
		const METHOD = 'zai-usage-ring/usage';
		const NS = 'zai-usage-ring';
		const POS_KEY = 'zai-usage-ring:pos';
		const DRAG_THRESHOLD_PX = 4;

		const DICT = {
			en: {
				title: 'Z.AI Coding Plan',
				expand: 'Show coding plan usage',
				collapse: 'Hide coding plan usage',
				refresh: 'Refresh usage',
				updatedAt: 'Updated {time}',
				fetchFailed: 'Could not load usage',
				noWindows: 'No usage windows reported',
				winFiveHour: '5-hour window',
				winWeekly: 'Weekly pool',
				winMcp: 'MCP / tools',
				usedOfTotal: '{used} / {total} used',
				resetIn: 'resets in {duration}',
				resetAt: 'resets at {time}',
				overdue: 'awaiting reset',
				mcpTools: 'Per-tool usage',
				highest: 'highest window',
				dayShort: 'd',
				siteGlobal: 'Z.AI (global)',
				siteCn: 'BigModel (China)'
			},
			ko: {
				title: 'Z.AI 코딩 플랜',
				expand: '코딩 플랜 사용량 보기',
				collapse: '코딩 플랜 사용량 닫기',
				refresh: '사용량 새로 고침',
				updatedAt: '업데이트 {time}',
				fetchFailed: '사용량을 불러오지 못했습니다',
				noWindows: '표시할 사용량 창이 없습니다',
				winFiveHour: '5시간 창',
				winWeekly: '주간 풀',
				winMcp: 'MCP / 도구',
				usedOfTotal: '{used} / {total} 사용',
				resetIn: '{duration} 후 리셋',
				resetAt: '{time} 리셋',
				overdue: '리셋 대기 중',
				mcpTools: '도구별 사용량',
				highest: '가장 높은 창',
				dayShort: '일',
				siteGlobal: 'Z.AI (글로벌)',
				siteCn: '빅모델 (중국)'
			},
			zh: {
				title: 'Z.AI 编码套餐',
				expand: '显示编码套餐用量',
				collapse: '收起编码套餐用量',
				refresh: '刷新用量',
				updatedAt: '更新于 {time}',
				fetchFailed: '无法获取用量',
				noWindows: '没有返回用量窗口',
				winFiveHour: '5 小时窗口',
				winWeekly: '每周额度',
				winMcp: 'MCP / 工具',
				usedOfTotal: '已用 {used} / {total}',
				resetIn: '{duration}后重置',
				resetAt: '{time} 重置',
				overdue: '等待重置',
				mcpTools: '各工具用量',
				highest: '最高窗口',
				dayShort: '天',
				siteGlobal: 'Z.AI（全球）',
				siteCn: 'BigModel（中国）'
			}
		};

		const WINDOW_LABEL_KEY = { fiveHour: 'winFiveHour', weekly: 'winWeekly', mcp: 'winMcp' };
		const WINDOW_ORDER = ['fiveHour', 'weekly', 'mcp'];
		const R = 25;
		const CIRC = 2 * Math.PI * R;

		const CSS = [
			'#zai-ur-root{position:fixed;right:18px;bottom:18px;z-index:900;display:flex;flex-direction:column;align-items:flex-end;pointer-events:auto;color:var(--dsw-alias-label-primary,#1b1b1c);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","PingFang SC","Microsoft YaHei",sans-serif);font-size:13px;line-height:1.45}',
			'#zai-ur-root *{box-sizing:border-box}',
			'.zai-ur-capsule{display:flex;align-items:center;gap:7px;padding:5px 12px 5px 7px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 4px 14px rgba(0,0,0,.12);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;color:inherit;font:inherit}',
			'.zai-ur-capsule:hover{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.2))}',
			'.zai-ur-capsule:active{cursor:grabbing}',
			'#zai-ur-root.zai-ur-dragging{cursor:grabbing}',
			'#zai-ur-root.zai-ur-dragging .zai-ur-capsule{cursor:grabbing}',
			'#zai-ur-root.zai-ur-dragging .zai-ur-card{pointer-events:none}',
			'#zai-ur-root.zai-ur-flip{flex-direction:column-reverse;align-items:flex-start}',
			'#zai-ur-root.zai-ur-flip .zai-ur-card{margin-bottom:0;margin-top:8px}',
			'body.zai-ur-noselect{user-select:none!important;-webkit-user-select:none!important;cursor:grabbing}',
			'.zai-ur-capsule-val{font-weight:600;font-size:13px;font-variant-numeric:tabular-nums;min-width:34px;text-align:right}',
			'.zai-ur-card{width:352px;max-width:calc(100vw - 36px);margin-bottom:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 28px rgba(0,0,0,.16)}',
			'.zai-ur-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}',
			'.zai-ur-head-title{font-weight:600;font-size:13.5px}',
			'.zai-ur-level{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.18));color:var(--dsw-alias-label-secondary,#6e6e73);text-transform:uppercase;letter-spacing:.03em}',
			'.zai-ur-spacer{flex:1}',
			'.zai-ur-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6e6e73);cursor:pointer;font:inherit;font-size:12px;line-height:1}',
			'.zai-ur-btn:hover{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.2));color:var(--dsw-alias-label-primary,#1b1b1c)}',
			'.zai-ur-btn[disabled]{opacity:.5;cursor:default}',
			'.zai-ur-spin{animation:zai-ur-rot .9s linear infinite;display:inline-block}',
			'@keyframes zai-ur-rot{to{transform:rotate(360deg)}}',
			'.zai-ur-gauges{display:flex;justify-content:space-around;gap:6px}',
			'.zai-ur-gauge{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;flex:1}',
			'.zai-ur-ring-wrap{position:relative;width:72px;height:72px}',
			'.zai-ur-ring-svg{display:block;width:72px;height:72px}',
			'.zai-ur-ring-arc{transition:stroke-dasharray .4s ease,stroke .3s ease}',
			'.zai-ur-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}',
			'.zai-ur-ring-pct{font-weight:600;font-size:14.5px;font-variant-numeric:tabular-nums}',
			'.zai-ur-glabel{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6e6e73);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
			'.zai-ur-gcount{font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#6e6e73)}',
			'.zai-ur-greset{font-size:11px;font-variant-numeric:tabular-nums;text-align:center;color:var(--dsw-alias-label-secondary,#6e6e73)}',
			'.zai-ur-greset b{font-weight:600;color:var(--dsw-alias-label-primary,#1b1b1c)}',
			'.zai-ur-foot{margin-top:10px;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#6e6e73)}',
			'.zai-ur-dot{width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-state-success-primary,#30a46c);flex-shrink:0}',
			'.zai-ur-msg{padding:8px 2px 2px;color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12.5px;display:flex;align-items:center;gap:8px}',
			'.zai-ur-msg .zai-ur-btn{width:auto;padding:0 8px;font-size:12px}'
		].join('\n');

		function pctText(pct) {
			return pct === null || pct === undefined ? '—' : `${Math.round(pct)}%`;
		}

		function tierOf(pct) {
			if (pct === null || pct === undefined) return 'idle';
			if (pct >= 90) return 'error';
			if (pct >= 70) return 'warn';
			return 'ok';
		}

		function colorOf(tier) {
			if (tier === 'error') return 'var(--dsw-alias-state-error-primary,#e5484d)';
			if (tier === 'warn') return 'var(--dsw-alias-state-warn-primary,#f5a623)';
			if (tier === 'idle') return 'var(--dsw-alias-state-idle-primary,#9b9ba3)';
			return 'var(--dsw-alias-brand-primary,#3b82f6)';
		}

		/** "1:23:45" / "12:05" / "2d 05h" style countdown text. */
		function fmtDuration(ms, t) {
			const s = Math.max(0, Math.floor(ms / 1000));
			if (s >= 86400) {
				const d = Math.floor(s / 86400);
				const hr = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
				return `${d}${t('dayShort')} ${hr}h`;
			}
			if (s >= 3600) {
				const hh = Math.floor(s / 3600);
				const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
				const ss = String(s % 60).padStart(2, '0');
				return `${hh}:${mm}:${ss}`;
			}
			const m = Math.floor(s / 60);
			const sec = String(s % 60).padStart(2, '0');
			return `${m}:${sec}`;
		}

		function localeTagOf(id) {
			if (id === 'ko') return 'ko-KR';
			if (id === 'zh') return 'zh-CN';
			if (id === 'en') return 'en-US';
			return undefined;
		}

		/** Saved drag position ({x,y} px) or null when pinned to the CSS default spot. */
		function readSavedPos() {
			try {
				const raw = window.localStorage.getItem(POS_KEY);
				if (!raw) return null;
				const p = JSON.parse(raw);
				if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
			} catch (e) { /* corrupted or unavailable storage */ }
			return null;
		}

		function savePos(p) {
			try {
				window.localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }));
			} catch (e) { /* storage unavailable; position just won't persist */ }
		}

		/** Keep a widget of w×h parked at (x,y) fully inside the viewport. */
		function clampPos(x, y, w, h) {
			const margin = 8;
			const maxX = Math.max(margin, window.innerWidth - w - margin);
			const maxY = Math.max(margin, window.innerHeight - h - margin);
			return { x: Math.min(Math.max(x, margin), maxX), y: Math.min(Math.max(y, margin), maxY) };
		}

		/** Apply (or clear) the dragged left/top position on the root element. */
		function applyPosStyle(el, p) {
			if (p) {
				el.style.left = Math.round(p.x) + 'px';
				el.style.top = Math.round(p.y) + 'px';
				el.style.right = 'auto';
				el.style.bottom = 'auto';
			} else {
				el.style.removeProperty('left');
				el.style.removeProperty('top');
				el.style.removeProperty('right');
				el.style.removeProperty('bottom');
			}
		}

		function fmtClock(ts, getLocaleId) {
			const date = new Date(ts);
			const tag = localeTagOf(getLocaleId());
			const now = new Date();
			const sameDay = date.getFullYear() === now.getFullYear()
				&& date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
			const time = date.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
			if (sameDay) return time;
			const day = date.toLocaleDateString(tag, { month: '2-digit', day: '2-digit' });
			return `${day} ${time}`;
		}

		/** One circular gauge: SVG ring + center percent + label/count/reset. */
		function Gauge(props) {
			const { t, win, now, getLocaleId } = props;
			const pct = win.percentage;
			const tier = tierOf(pct);
			const color = colorOf(tier);
			const p = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct));
			const label = t(WINDOW_LABEL_KEY[win.id]);
			const titleParts = [label];
			if (win.used !== null && win.used !== undefined && win.total !== null && win.total !== undefined) {
				titleParts.push(t('usedOfTotal', { used: win.used, total: win.total }));
			}
			const detailText = (win.details || []).map((d) => `${d.code}: ${d.usage}`).join(', ');
			if (detailText) titleParts.push(detailText);
			let count = null;
			if (win.used !== null && win.used !== undefined && win.total !== null && win.total !== undefined) {
				count = h('div', { className: 'zai-ur-gcount' }, t('usedOfTotal', { used: win.used, total: win.total }));
			}
			let reset = null;
			if (win.resetAt) {
				const left = win.resetAt - now;
				const countdown = left > 0
					? t('resetIn', { duration: fmtDuration(left, t) })
					: t('overdue');
				reset = h('div', {
					className: 'zai-ur-greset',
					title: t('resetAt', { time: new Date(win.resetAt).toLocaleString(localeTagOf(getLocaleId())) })
				}, h('b', null, countdown));
			}
			return h('div', { className: 'zai-ur-gauge', title: titleParts.join(' · ') },
				h('div', { className: 'zai-ur-ring-wrap' },
					h('svg', { className: 'zai-ur-ring-svg', viewBox: '0 0 64 64', role: 'img', 'aria-label': `${label} ${pctText(pct)}` },
						h('circle', { cx: 32, cy: 32, r: R, fill: 'none', stroke: 'var(--dsw-alias-border-l1,rgba(0,0,0,.12))', strokeWidth: 7.5 }),
						h('circle', {
							className: 'zai-ur-ring-arc', cx: 32, cy: 32, r: R, fill: 'none',
							stroke: color, strokeWidth: 7.5, strokeLinecap: 'round',
							strokeDasharray: `${(CIRC * p) / 100} ${CIRC}`, transform: 'rotate(-90 32 32)'
						})),
					h('div', { className: 'zai-ur-ring-center' },
						h('span', { className: 'zai-ur-ring-pct', style: { color } }, pctText(pct)))),
				h('div', { className: 'zai-ur-glabel' }, label),
				count, reset);
		}

		function applyInner(ctx) {
			ctx.effect(function () {
				const tag = document.createElement('style');
				tag.dataset.plugin = '@local/zai-usage-ring';
				tag.textContent = CSS;
				document.head.append(tag);
				return function () { tag.remove(); };
			});

			ctx.effect(function () {
				return ctx.locale.register(NS, DICT);
			}, '@local/zai-usage-ring: copy dictionaries');
			const boundT = ctx.locale.bind(NS);
			const getLocaleId = () => ctx.locale.getLocale().active;

			function UsageRing(props) {
				const t = typeof props.t === 'function' ? props.t : boundT;
				const [data, setData] = React.useState(null);
				const [error, setError] = React.useState(null);
				const [refreshing, setRefreshing] = React.useState(false);
				const [expanded, setExpanded] = React.useState(false);
				const [now, setNow] = React.useState(() => Date.now());

				// ── Drag-to-move state ─────────────────────────────────────
				// `pos === null` keeps the CSS default spot (fixed bottom-right);
				// otherwise the root is pinned at top-left (x,y) from localStorage.
				const rootRef = React.useRef(null);
				const [pos, setPos] = React.useState(readSavedPos);
				const [dragging, setDragging] = React.useState(false);
				const dragState = React.useRef(null);
				const draggingRef = React.useRef(false);
				const suppressClickRef = React.useRef(false);

				// `load` must stay referentially stable: effects below key on it.
				// Failure copy inside it reads the memoized `boundT`, not the
				// possibly-unstable `props.t`.
				const load = React.useCallback(function () {
					setRefreshing(true);
					return ctx.connection.rpc.call(CHANNEL, METHOD, null).then(function (result) {
						if (result && result.ok === true && result.value && Array.isArray(result.value.windows)) {
							setData(result.value);
							setError(null);
						} else {
							setError(result && result.error ? result.error.message : boundT('fetchFailed'));
						}
					}).catch(function (e) {
						setError(String((e && e.message) || e) || boundT('fetchFailed'));
					}).finally(function () {
						setRefreshing(false);
					});
				}, []);

				React.useEffect(function () {
					load();
				}, [load]);

				const refreshMs = data && typeof data.refreshMs === 'number' && data.refreshMs >= 5000 ? data.refreshMs : 60000;
				React.useEffect(function () {
					return ctx.interval(function () {
						if (!document.hidden) load();
					}, refreshMs);
				}, [refreshMs, load]);

				React.useEffect(function () {
					const onVisible = function () {
						if (!document.hidden) load();
					};
					document.addEventListener('visibilitychange', onVisible);
					return function () { document.removeEventListener('visibilitychange', onVisible); };
				}, [load]);

				// ── Drag-to-move ───────────────────────────────────────────
				// The capsule and the expanded card header double as drag
				// handles. A press that moves less than DRAG_THRESHOLD_PX stays
				// a click, so the capsule keeps its expand/collapse behaviour.
				// The position persists in localStorage and is clamped to stay
				// inside the viewport (also re-clamped on expand, since the
				// card changes the root's size, and on window resize).
				React.useLayoutEffect(function () {
					const el = rootRef.current;
					if (el) applyPosStyle(el, pos);
				}, [pos]);

				React.useLayoutEffect(function () {
					if (!pos) return;
					const el = rootRef.current;
					if (!el) return;
					const next = clampPos(pos.x, pos.y, el.offsetWidth, el.offsetHeight);
					if (next.x !== pos.x || next.y !== pos.y) {
						setPos(next);
						savePos(next);
					}
				}, [expanded, pos]);

				React.useEffect(function () {
					const onResize = function () {
						setPos(function (cur) {
							if (!cur) return cur;
							const el = rootRef.current;
							const w = el ? el.offsetWidth : 200;
							const h = el ? el.offsetHeight : 40;
							const next = clampPos(cur.x, cur.y, w, h);
							if (next.x !== cur.x || next.y !== cur.y) {
								savePos(next);
								return next;
							}
							return cur;
						});
					};
					window.addEventListener('resize', onResize);
					return function () { window.removeEventListener('resize', onResize); };
				}, []);

				const dragStart = function (event, isCapsule) {
					if (event.button !== undefined && event.button !== 0) return;
					if (event.target.closest && event.target.closest('.zai-ur-btn')) return;
					const el = rootRef.current;
					if (!el) return;
					dragState.current = {
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						baseX: el.offsetLeft,
						baseY: el.offsetTop,
						w: el.offsetWidth,
						h: el.offsetHeight,
						isCapsule: !!isCapsule,
						moved: false,
						cur: null
					};
					try { event.currentTarget.setPointerCapture(event.pointerId); } catch (e) { /* best-effort */ }
				};

				const dragMove = function (event) {
					const st = dragState.current;
					if (!st || event.pointerId !== st.pointerId) return;
					const dx = event.clientX - st.startX;
					const dy = event.clientY - st.startY;
					if (!st.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
					if (!st.moved) {
						st.moved = true;
						draggingRef.current = true;
						setDragging(true);
						document.body.classList.add('zai-ur-noselect');
					}
					st.cur = clampPos(st.baseX + dx, st.baseY + dy, st.w, st.h);
					const el = rootRef.current;
					if (el) applyPosStyle(el, st.cur);
					event.preventDefault();
				};

				const dragEnd = function (event) {
					const st = dragState.current;
					if (!st || event.pointerId !== st.pointerId) return;
					dragState.current = null;
					try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (e) { /* best-effort */ }
					if (st.moved) {
						if (st.isCapsule) suppressClickRef.current = true;
						const final = st.cur || { x: st.baseX, y: st.baseY };
						setPos(final);
						savePos(final);
					}
					draggingRef.current = false;
					setDragging(false);
					document.body.classList.remove('zai-ur-noselect');
				};

				const dragHandlers = function (isCapsule) {
					return {
						onPointerDown: function (e) { dragStart(e, isCapsule); },
						onPointerMove: dragMove,
						onPointerUp: dragEnd,
						onPointerCancel: dragEnd
					};
				};

				React.useEffect(function () {
					if (!expanded) return;
					return ctx.interval(function () {
						setNow(Date.now());
					}, 1000);
				}, [expanded]);

				const windows = data
					? WINDOW_ORDER.map((id) => data.windows.find((w) => w.id === id)).filter(Boolean)
					: [];
				const highest = windows.length
					? windows.reduce((a, b) => ((b.percentage ?? -1) >= (a.percentage ?? -1) ? b : a))
					: null;
				const capsuleTier = error && !data ? 'idle' : tierOf(highest ? highest.percentage : null);
				const capsuleP = highest ? Math.max(0, Math.min(100, highest.percentage ?? 0)) : 0;

				// Once dragged, the capsule is the anchor: it stays exactly at
				// (x,y) and the expanded card opens *below* it (flip), left
				// aligned, so expand/collapse never makes the capsule jump.
				const flip = pos !== null;
				const rootProps = {
					id: 'zai-ur-root',
					ref: rootRef,
					className: [dragging ? 'zai-ur-dragging' : null, flip ? 'zai-ur-flip' : null].filter(Boolean).join(' ') || undefined
				};

				const capsule = h('button', {
					className: 'zai-ur-capsule', type: 'button',
					'aria-expanded': expanded, 'aria-label': t('expand'),
					title: highest
						? `${t(WINDOW_LABEL_KEY[highest.id])} ${pctText(highest.percentage)} · ${t('highest')}`
						: (error || t('fetchFailed')),
					onClick: function () {
						if (suppressClickRef.current) { suppressClickRef.current = false; return; }
						setExpanded(!expanded); setNow(Date.now());
					},
					...dragHandlers(true) },
					h('svg', { viewBox: '0 0 64 64', width: 26, height: 26, 'aria-hidden': true },
						h('circle', { cx: 32, cy: 32, r: R, fill: 'none', stroke: 'var(--dsw-alias-border-l1,rgba(0,0,0,.12))', strokeWidth: 9 }),
						h('circle', {
							className: 'zai-ur-ring-arc', cx: 32, cy: 32, r: R, fill: 'none',
							stroke: colorOf(capsuleTier), strokeWidth: 9, strokeLinecap: 'round',
							strokeDasharray: `${(CIRC * capsuleP) / 100} ${CIRC}`,
							transform: 'rotate(-90 32 32)'
						})),
					h('span', { className: 'zai-ur-capsule-val' }, error && !data ? '—' : pctText(highest ? highest.percentage : null)));

				if (!expanded) {
					return h('div', rootProps, capsule);
				}

				const body = error && !data
					? h('div', { className: 'zai-ur-msg' }, error,
						h('button', { className: 'zai-ur-btn', type: 'button', onClick: load, disabled: refreshing }, t('refresh')))
					: h('div', { className: 'zai-ur-gauges' },
						windows.length
							? windows.map((win) => h(Gauge, { key: win.id, t, win, now, getLocaleId }))
							: h('div', { className: 'zai-ur-msg' }, t('noWindows')));

				return h('div', rootProps,
					h('div', { className: 'zai-ur-card' },
						h('div', { className: 'zai-ur-head', ...dragHandlers(false) },
							h('span', { className: 'zai-ur-head-title' }, t('title')),
							data && data.level ? h('span', { className: 'zai-ur-level' }, data.level) : null,
							h('span', { className: 'zai-ur-spacer' }),
							h('button', {
								className: 'zai-ur-btn', type: 'button', 'aria-label': t('refresh'),
								title: t('refresh'), onClick: load, disabled: refreshing
							}, h('span', { className: refreshing ? 'zai-ur-spin' : undefined, style: { display: 'inline-block' } }, '↻')),
							h('button', {
								className: 'zai-ur-btn', type: 'button', 'aria-label': t('collapse'),
								title: t('collapse'), onClick: function () { setExpanded(false); }
							}, '▴')),
						body,
						data ? h('div', { className: 'zai-ur-foot' },
							h('span', { className: 'zai-ur-dot' }),
							h('span', null, t('updatedAt', {
								time: new Date(data.fetchedAt).toLocaleTimeString(localeTagOf(getLocaleId()))
							})),
							h('span', { className: 'zai-ur-spacer' }),
							h('span', { title: data.ref }, t(data.site === 'cn' ? 'siteCn' : 'siteGlobal'))) : null),
					capsule);
			}

			ctx.slots.inject('shell.overlay', () => {
				__zaiBeacon('reg:overlay');
				return ctx.slots.register(
					{ name: 'shell.overlay', id: 'zai-usage-ring', order: 100, label: () => boundT('title'), locale: NS },
					(props) => h(UsageRing, props));
			});
			__zaiBeacon('apply:done');
		}

		function apply(ctx) {
			__zaiBeacon('apply');
			return applyInner(ctx);
		}

		return { inject: ['slots', 'timer', 'connection', 'locale'], apply };
	}
});
