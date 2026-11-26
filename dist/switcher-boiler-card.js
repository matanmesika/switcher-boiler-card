// Switcher Boiler Card — https://github.com/matanmesika/switcher-boiler-card
// The Switcher app's Home, Schedule and History screens for a Switcher water heater in
// Home Assistant (switcher_kis). With only `entity` set, the card finds the device's own
// sensors and uses the integration's timer service. Optional scripts let your own
// automations handle runs. Schedules use the Scheduler integration; history and costs
// come from the recorder.
const CARD_VERSION = '1.0.1';
// switcher_kis.turn_on_with_timer accepts 1–150 minutes.
const SWITCHER_TIMER_MAX = 150;
const DEFAULTS = {
  name: 'Boiler',
  dial_max: 60,
  schedule_tag: 'boiler',
  history_days: 30,
  auto_off_options: ['01:00', '01:30', '02:00', '02:30', '03:00', '04:00', '05:00', '06:00', '08:00', '12:00'],
};
/** Finds the Switcher device's own sensors next to the boiler switch (automatic setup). */
const detectSwitcher = (hass, entityId) => {
  const device = hass?.entities?.[entityId]?.device_id;
  if (!device) return {};
  const sensors = Object.values(hass.entities).filter((e) => e.device_id === device && e.entity_id.startsWith('sensor.'));
  const pick = (test) => sensors.find((e) => test(e, hass.states[e.entity_id]?.attributes ?? {}))?.entity_id;
  const found = {
    power: pick((e, a) => a.device_class === 'power' || /_power$/.test(e.entity_id)),
    current: pick((e, a) => a.device_class === 'current' || /_current$/.test(e.entity_id)),
    remaining: pick((e) => e.translation_key === 'remaining_time' || /_remaining_time$/.test(e.entity_id)),
    auto_shutdown: pick((e) => e.translation_key === 'auto_shutdown' || /_auto_shutdown$/.test(e.entity_id)),
  };
  Object.keys(found).forEach((key) => found[key] === undefined && delete found[key]);
  return found;
};
/** Minutes between two HH:MM times, across midnight when needed. */
const slotMinutes = (start, stop) => {
  const [a, b] = [start, stop].map((t) => parseHms(t) / 60);
  return b > a ? b - a : b + 1440 - a;
};
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const pad = (n) => String(n).padStart(2, '0');
const parseHms = (value) => {
  const match = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0) : undefined;
};
const clock = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};
const hoursText = (seconds) => {
  if (seconds === undefined) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (!h) return `${m} minutes`;
  if (!m) return h === 1 ? '1 Hour' : `${h} Hours`;
  return `${h} hours and ${m} minutes`;
};
const esc = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const STYLE = `
  :host { --sb-accent: var(--switcher-accent, #ec6650); --sb-warm: #f6c77d; --sb-text: var(--primary-text-color); --sb-muted: var(--secondary-text-color); --sb-line: var(--divider-color); --sb-fill: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  ha-card { overflow: hidden; padding: 0; }
  .title { padding: 18px 18px 0; text-align: center; font-size: 18px; font-weight: 700; }
  .page { display: none; box-sizing: border-box; height: var(--switcher-height, 560px); padding: 8px 18px 18px; overflow: hidden; }
  .page.active { display: flex; flex-direction: column; }
  /* Only a part whose content is taller than the card scrolls; the page itself never does. */
  .page[data-page="schedule"] { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
  .page[data-page="home"] { justify-content: center; }
  .sub-body { flex: 1 1 auto; min-height: 0; margin: 0 -18px; padding: 0 18px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
  .sub-body.costs { overflow: hidden; display: flex; flex-direction: column; }
  .dial { position: relative; flex: none; width: min(300px, 78vw, calc(var(--switcher-height, 560px) - 250px)); aspect-ratio: 1; margin: 10px auto 0; border-radius: 50%; touch-action: none; user-select: none;
    background: radial-gradient(circle, color-mix(in srgb, var(--sb-text) 5%, transparent) 55%, color-mix(in srgb, var(--sb-text) 2%, transparent) 70%, transparent 71%); }
  .disc { position: absolute; inset: 13%; border-radius: 50%; background: color-mix(in srgb, var(--sb-text) 7%, transparent); box-shadow: inset 0 2px 10px rgba(0,0,0,.25), 0 10px 30px rgba(0,0,0,.25); }
  .dial svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .tick { stroke: var(--sb-muted); stroke-width: .5; opacity: .7; }
  .tick-label { fill: var(--sb-muted); font-size: 5px; text-anchor: middle; dominant-baseline: middle; }
  .arc-done { fill: none; stroke: var(--sb-accent); stroke-width: 2.2; opacity: .3; }
  .laps { fill: var(--sb-accent); font-size: 5.5px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
  .arc { fill: none; stroke: var(--sb-accent); stroke-width: 2.2; stroke-linecap: round; filter: drop-shadow(0 0 2px var(--sb-accent)); }
  .knob { position: absolute; width: 15%; aspect-ratio: 1; margin: -7.5% 0 0 -7.5%; border-radius: 50%; display: grid; place-items: center; color: var(--sb-accent);
    background: var(--card-background-color, #fff); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sb-accent) 35%, transparent), 0 0 18px color-mix(in srgb, var(--sb-accent) 55%, transparent); cursor: grab; touch-action: none; }
  .knob ha-icon { --mdc-icon-size: 22px; transition: transform .15s ease; }
  .power { position: absolute; left: 50%; top: 50%; width: 22%; aspect-ratio: 1; transform: translate(-50%, -50%); border: 0; border-radius: 50%; display: grid; place-items: center; color: var(--sb-text); cursor: pointer;
    background: color-mix(in srgb, var(--sb-text) 10%, var(--card-background-color, #222)); box-shadow: 0 0 26px color-mix(in srgb, var(--sb-accent) 45%, transparent), 0 4px 12px rgba(0,0,0,.3); }
  .power ha-icon { --mdc-icon-size: 32px; }
  .on .power { color: #fff; background: var(--sb-accent); box-shadow: 0 0 40px color-mix(in srgb, var(--sb-accent) 75%, transparent); }
  .status { flex: none; margin: 14px 4px 4px; font-size: 40px; font-weight: 800; letter-spacing: .5px; }
  .status-sub { flex: none; margin: 0 4px 14px; height: 22px; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--sb-muted); font-size: 15px; }
  .on .status-sub { color: var(--sb-accent); font-weight: 600; }
  .info { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; align-items: stretch; }
  .info .muted { font-size: 12px; line-height: 1.2; }
  .info .value { font-size: 16px; }
  .shutdown { position: relative; display: grid; justify-items: center; align-content: center; text-align: center; gap: 2px; padding: 10px 6px; border: 1px solid var(--sb-line); border-radius: 14px; background: var(--sb-fill); cursor: pointer; }
  .shutdown ha-icon { color: var(--sb-accent); --mdc-icon-size: 22px; }
  .shutdown select { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
  .shutdown select option { color: #1c1c1e; background: #fff; }
  .muted { color: var(--sb-muted); font-size: 15px; }
  .value { font-size: 19px; font-weight: 600; }
  .use { padding: 10px 4px; display: grid; justify-items: center; align-content: center; text-align: center; gap: 2px; cursor: pointer; border: 1px solid var(--sb-line); border-radius: 14px; }
  .use[hidden] { display: none; }
  .nav { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--sb-line); background: color-mix(in srgb, var(--sb-text) 3%, transparent); }
  .nav button { display: grid; justify-items: center; gap: 4px; padding: 10px 0 12px; border: 0; color: var(--sb-muted); background: transparent; font: inherit; font-size: 14px; cursor: pointer; }
  .nav button ha-icon { --mdc-icon-size: 24px; }
  .nav button.active { color: var(--sb-accent); }
  .subtabs { display: grid; grid-template-columns: 1fr 1fr; margin: 4px -18px 14px; border-bottom: 1px solid var(--sb-line); }
  .subtabs button { position: relative; padding: 14px 0; border: 0; color: var(--sb-muted); background: transparent; font: inherit; font-size: 17px; cursor: pointer; }
  .subtabs button.active { color: var(--sb-text); font-weight: 700; }
  .subtabs button.active::after { content: ''; position: absolute; left: 12%; right: 12%; bottom: -1px; height: 3px; border-radius: 3px; background: var(--sb-accent); }
  .day { margin-bottom: 12px; border-radius: 18px; background: var(--sb-fill); border: 1px solid var(--sb-line); overflow: hidden; }
  .day h4 { margin: 0; padding: 14px 16px; font-size: 16px; border-bottom: 1px solid var(--sb-line); }
  .run { display: grid; grid-template-columns: 52px 1fr; align-items: center; gap: 10px; padding: 10px 16px; }
  .run + .run { border-top: 1px solid var(--sb-line); }
  .bar { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .bar span { height: 10px; min-width: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--sb-accent), var(--sb-warm)); }
  .bar b { font-weight: 500; white-space: nowrap; }
  .empty { padding: 40px 10px; text-align: center; color: var(--sb-muted); }
  .range { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: end; margin-bottom: 14px; }
  .range label { display: grid; gap: 6px; color: var(--sb-muted); font-weight: 700; }
  .range input { min-height: 44px; padding: 6px 12px; border: 1px solid var(--sb-line); border-radius: 22px; color: var(--sb-text); background: var(--sb-fill); font: inherit; color-scheme: light dark; }
  .range i { width: 22px; height: 3px; margin-bottom: 20px; background: var(--sb-line); }
  .panel { padding: 16px; border-radius: 18px; border: 1px solid var(--sb-line); background: var(--sb-fill); margin-bottom: 14px; }
  .line { display: grid; grid-template-columns: 30px 1fr; gap: 10px; align-items: start; }
  .line + .line { margin-top: 16px; }
  .line ha-icon { --mdc-icon-size: 26px; }
  .chart h4 { margin: 0 0 12px; font-size: 16px; }
  .bars { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 18px; align-items: end; height: 170px; padding: 0 6px; border-left: 1px solid var(--sb-line); border-bottom: 1px solid var(--sb-line); }
  .bars div { display: grid; justify-items: center; align-content: end; gap: 6px; height: 100%; }
  .bars em { font-style: normal; font-weight: 700; color: var(--sb-muted); font-size: 13px; }
  .bars div.now em { color: var(--sb-accent); }
  .bars span { width: 70%; min-height: 2px; border-radius: 10px 10px 0 0; background: color-mix(in srgb, var(--sb-accent) 35%, transparent); }
  .bars div.now span { background: var(--sb-accent); }
  .months { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 18px; padding: 6px 6px 0; text-align: center; color: var(--sb-muted); font-size: 13px; }
  .costs .range { margin-bottom: 10px; }
  .costs .range input { min-height: 38px; padding: 4px 10px; }
  .costs .range label { gap: 4px; }
  .costs .panel { padding: 12px 14px; margin-bottom: 10px; }
  .costs .line + .line { margin-top: 10px; }
  .costs .line ha-icon { --mdc-icon-size: 22px; }
  .costs .value { font-size: 17px; }
  .costs .muted { font-size: 13px; }
  .costs .chart { margin-bottom: 0; }
  .costs .chart h4 { margin-bottom: 8px; font-size: 15px; }
  .costs .bars { height: 104px; gap: 14px; }
  .costs .bars em { font-size: 12px; }
  .costs .months { gap: 14px; font-size: 12px; }
  .illus { display: grid; place-items: center; margin: 30px auto 10px; width: 120px; height: 120px; border-radius: 30px; color: var(--sb-accent); background: linear-gradient(160deg, color-mix(in srgb, var(--sb-accent) 22%, transparent), color-mix(in srgb, var(--sb-warm) 20%, transparent)); }
  .illus ha-icon { --mdc-icon-size: 64px; }
  .center { text-align: center; }
  .center h3 { margin: 14px 0 6px; font-size: 20px; }
  .primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 22px; border: 0; border-radius: 12px; color: #fff; background: var(--sb-accent); font: inherit; font-size: 17px; font-weight: 700; cursor: pointer; }
  .secondary { min-height: 48px; padding: 0 22px; border: 1px solid var(--sb-line); border-radius: 12px; color: var(--sb-text); background: transparent; font: inherit; font-weight: 600; cursor: pointer; }
  .sched { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 14px 16px; margin-bottom: 10px; border-radius: 18px; border: 1px solid var(--sb-line); background: var(--sb-fill); }
  .sched strong { display: block; font-size: 19px; }
  .sched small { color: var(--sb-muted); }
  .icon-btn { width: 40px; height: 40px; border: 0; border-radius: 50%; display: grid; place-items: center; color: var(--sb-muted); background: transparent; cursor: pointer; }
  .toggle { position: relative; width: 50px; height: 30px; border: 0; border-radius: 15px; background: var(--sb-line); cursor: pointer; }
  .toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .toggle.on { background: var(--sb-accent); }
  .toggle.on::after { transform: translateX(20px); }
  .form { display: grid; gap: 14px; }
  .times { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .times label { display: grid; gap: 6px; color: var(--sb-muted); font-weight: 600; }
  .times input { min-height: 48px; padding: 6px 12px; border: 1px solid var(--sb-line); border-radius: 14px; color: var(--sb-text); background: var(--sb-fill); font: inherit; font-size: 20px; font-weight: 700; color-scheme: light dark; }
  .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .days button { min-height: 42px; border: 1px solid var(--sb-line); border-radius: 21px; color: var(--sb-text); background: transparent; font: inherit; font-weight: 600; cursor: pointer; }
  .days button.on { border-color: var(--sb-accent); color: #fff; background: var(--sb-accent); }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .add-row { display: flex; justify-content: center; margin-top: 6px; }
  .toast { padding: 0 18px 12px; color: var(--error-color); font-size: 13px; }
`;

class SwitcherBoilerCard extends HTMLElement {
  static getConfigElement() { return document.createElement('switcher-boiler-card-editor'); }
  static getStubConfig(hass) {
    const switches = Object.keys(hass?.states || {}).filter((e) => e.startsWith('switch.'));
    const sw = switches.find((e) => hass.entities?.[e]?.platform === 'switcher_kis') ?? switches.find((e) => e.includes('boiler'));
    return { entity: sw || '', name: 'Switcher' };
  }
  setConfig(config) {
    if (!config.entity) throw new Error('entity is required');
    this._config = { ...DEFAULTS, ...config };
    this._page = this._page ?? 'home';
    this._sub = this._sub ?? 'history';
    this._selected = this._selected ?? 0;
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    // Automatic setup: fill the sensors the config leaves out from the Switcher device itself.
    if (this._detectedFor !== this._config.entity && hass.entities?.[this._config.entity]) {
      this._detectedFor = this._config.entity;
      const found = detectSwitcher(hass, this._config.entity);
      Object.entries(found).forEach(([key, id]) => { if (!this._config[key]) this._config[key] = id; });
    }
    if (!this._built) this._build();
    this._renderHome();
    const sig = Object.entries(hass.states).filter(([id]) => id.startsWith('switch.schedule_')).map(([id, s]) => id + s.state + s.last_updated).join();
    if (sig !== this._schedSig) {
      this._schedSig = sig;
      this._loadSchedules();
    }
    const state = hass.states[this._config.entity]?.state;
    if (state !== this._lastState) {
      this._lastState = state;
      this._historyLoaded = false;
      if (this._page === 'history') this._loadHistory();
    }
  }

  getCardSize() {
    return 9;
  }

  connectedCallback() {
    this._tick = setInterval(() => this._hass && this._renderHome(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this._tick);
  }

  _s(id) {
    return id ? this._hass.states[id] : undefined;
  }

  _err(error) {
    const toast = this._root.querySelector('.toast');
    toast.textContent = error?.message ?? error?.body?.message ?? String(error);
    toast.hidden = false;
  }

  _call(domain, service, data) {
    this._root.querySelector('.toast').hidden = true;
    return this._hass.callService(domain, service, data).catch((error) => this._err(error));
  }

  _remaining() {
    const timer = this._s(this._config.timer);
    if (timer?.state === 'active' && timer.attributes.finishes_at) return (new Date(timer.attributes.finishes_at).getTime() - Date.now()) / 1000;
    const sensor = parseHms(this._s(this._config.remaining)?.state);
    return sensor || undefined;
  }

  _build() {
    this._built = true;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    this._root = root;
    const ticks = [0, 15, 30, 45].map((minute) => {
      const angle = (minute / 60) * 2 * Math.PI;
      const x = (r) => (50 + r * Math.sin(angle)).toFixed(2);
      const y = (r) => (50 - r * Math.cos(angle)).toFixed(2);
      return `<line class="tick" x1="${x(36.5)}" y1="${y(36.5)}" x2="${x(34)}" y2="${y(34)}"/><text class="tick-label" x="${x(30.5)}" y="${y(30.5)}">${minute}</text>`;
    }).join('');
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="title"></div>
        <section class="page active" data-page="home">
          <div class="dial">
            <div class="disc"></div>
            <svg viewBox="0 0 100 100">${ticks}<path class="arc-done" d=""/><path class="arc" d=""/><text class="laps" x="50" y="71"></text></svg>
            <div class="knob" role="slider" aria-label="Timer minutes" aria-valuemin="0" tabindex="0"><ha-icon icon="mdi:chevron-right"></ha-icon></div>
            <button class="power" type="button" aria-label="Power"><ha-icon icon="mdi:power"></ha-icon></button>
          </div>
          <div class="status"></div>
          <div class="status-sub"></div>
          <div class="info">
            <label class="shutdown"><ha-icon icon="mdi:timer-outline"></ha-icon><span class="muted">Auto Shutdown</span><span class="value auto"></span><select aria-label="Auto Shutdown"></select></label>
            <div class="use" data-entity="temperature"><span class="muted">Water Temperature</span><span class="value temp"></span></div>
            <div class="use" data-entity="current"><span class="muted">Electricity use</span><span class="value amps"></span></div>
            <div class="use" data-entity="power"><span class="muted">Power</span><span class="value watts"></span></div>
          </div>
        </section>
        <section class="page" data-page="schedule"></section>
        <section class="page" data-page="history">
          <div class="subtabs"><button type="button" data-sub="history" class="active">History</button><button type="button" data-sub="costs">Electric costs</button></div>
          <div class="sub-body"></div>
        </section>
        <div class="toast" hidden></div>
        <nav class="nav">
          <button type="button" data-page="home" class="active"><ha-icon icon="mdi:white-balance-sunny"></ha-icon>Home</button>
          <button type="button" data-page="schedule"><ha-icon icon="mdi:calendar-blank-outline"></ha-icon>Schedule</button>
          <button type="button" data-page="history"><ha-icon icon="mdi:history"></ha-icon>History</button>
        </nav>
      </ha-card>`;
    root.querySelector('.knob').setAttribute('aria-valuemax', String(this._limit()));

    root.querySelector('.nav').addEventListener('click', (event) => {
      const page = event.target.closest('button')?.dataset.page;
      if (page) this._show(page);
    });
    root.querySelector('.subtabs').addEventListener('click', (event) => {
      const sub = event.target.closest('button')?.dataset.sub;
      if (!sub) return;
      this._sub = sub;
      root.querySelectorAll('.subtabs button').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
      this._renderHistory();
    });
    root.querySelector('.power').addEventListener('click', () => this._power());
    root.querySelectorAll('.use').forEach((el) => el.addEventListener('click', () => this._moreInfo(this._config[el.dataset.entity])));
    root.querySelector('.shutdown select').addEventListener('change', (event) => {
      this._call('switcher_kis', 'set_auto_off', { entity_id: this._config.entity, auto_off: `${event.target.value}:00` });
    });
    this._dial();
  }

  _moreInfo(entityId) {
    if (entityId) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  _show(page) {
    this._page = page;
    this._root.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === page));
    this._root.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    if (page === 'schedule') this._renderSchedules();
    if (page === 'history') {
      if (this._historyLoaded) this._renderHistory();
      else this._loadHistory();
    }
  }

  /** Drag the knob around the dial to choose the timer, as in the Switcher app. */
  /** Longest run the knob allows: max_minutes, else the device's Auto Shutdown, else 24 hours. */
  _limit() {
    if (this._config.max_minutes) return Number(this._config.max_minutes);
    const auto = parseHms(this._s(this._config.auto_shutdown)?.state);
    const limit = auto ? Math.round(auto / 60) : 1440;
    // Without a run script the card uses switcher_kis.turn_on_with_timer, which stops at 150 minutes.
    return this._config.run_script ? limit : Math.min(limit, SWITCHER_TIMER_MAX);
  }

  _dial() {
    const dial = this._root.querySelector('.dial');
    const knob = this._root.querySelector('.knob');
    const max = this._config.dial_max;
    const minutesAt = (event) => {
      const box = dial.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      let angle = Math.atan2(dx, -dy);
      if (angle < 0) angle += 2 * Math.PI;
      return (angle / (2 * Math.PI)) * max;
    };
    // One turn of the dial is dial_max minutes; keep turning for longer runs (like the app).
    let last = 0;
    let total = 0;
    let dragging = false;
    knob.addEventListener('pointerdown', (event) => {
      dragging = true;
      this._dragging = true;
      last = minutesAt(event);
      total = this._selected;
      knob.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    knob.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const now = minutesAt(event);
      let delta = now - last;
      if (delta > max / 2) delta -= max;
      if (delta < -max / 2) delta += max;
      last = now;
      total = Math.min(this._limit(), Math.max(0, total + delta));
      const minutes = Math.round(total);
      // The knob's arrow points the way it is being turned, like the app.
      if (minutes !== this._selected) this._dir = minutes > this._selected ? 1 : -1;
      this._selected = minutes;
      this._renderHome();
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this._dragging = false;
      this._dir = 1;
      // While the boiler runs, letting go of the knob restarts the run for the new time.
      if (this._s(this._config.entity)?.state === 'on' && this._selected > 0) this._run(this._selected);
      this._renderHome();
    };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
    knob.addEventListener('keydown', (event) => {
      const step = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      this._selected = Math.min(this._limit(), Math.max(0, this._selected + step * 5));
      this._renderHome();
    });
  }

  _run(minutes) {
    const { run_script: script, entity } = this._config;
    if (script) return this._call('script', 'turn_on', { entity_id: script, variables: { minutes } });
    return this._call('switcher_kis', 'turn_on_with_timer', { entity_id: entity, timer_minutes: minutes });
  }

  _power() {
    const { entity, off_script: offScript } = this._config;
    if (this._s(entity)?.state === 'on') {
      this._selected = 0;
      return offScript ? this._call('script', 'turn_on', { entity_id: offScript }) : this._call('switch', 'turn_off', { entity_id: entity });
    }
    if (this._selected > 0) return this._run(this._selected);
    return this._call('switch', 'turn_on', { entity_id: entity });
  }

  _renderHome() {
    const root = this._root;
    const config = this._config;
    const entity = this._s(config.entity);
    if (!root || !entity) return;
    const on = entity.state === 'on';
    root.querySelector('ha-card').classList.toggle('on', on);
    root.querySelector('.title').textContent = config.name;
    const remaining = on ? this._remaining() : undefined;
    // The dial shows the running timer, or the time chosen with the knob.
    const minutes = this._dragging || !on ? this._selected : remaining !== undefined ? remaining / 60 : 0;
    const turns = minutes / config.dial_max;
    const fraction = minutes > 0 && Number.isInteger(turns) ? 1 : turns % 1;
    const angle = fraction * 2 * Math.PI;
    const r = 43.5;
    const px = 50 + r * Math.sin(angle);
    const py = 50 - r * Math.cos(angle);
    const knob = root.querySelector('.knob');
    knob.style.left = `${px}%`;
    knob.style.top = `${py}%`;
    knob.setAttribute('aria-valuenow', String(Math.round(minutes)));
    // Arrow along the dial: right at the top, down at 15, left at 30, up at 45; reversed while turning back.
    knob.querySelector('ha-icon').style.transform = `rotate(${fraction * 360 + (this._dir === -1 ? 180 : 0)}deg)`;
    const arc = root.querySelector('.arc');
    let d = '';
    if (fraction >= 0.999) d = `M50 ${50 - r} A${r} ${r} 0 1 1 49.99 ${50 - r}`;
    else if (fraction > 0) d = `M50 ${50 - r} A${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${px.toFixed(2)} ${py.toFixed(2)}`;
    arc.setAttribute('d', d);
    // Turns already completed stay as a faint full ring under the current one, with a +1h / +2h badge.
    const laps = minutes > 0 ? Math.ceil(minutes / config.dial_max - 1e-9) - 1 : 0;
    root.querySelector('.arc-done').setAttribute('d', laps > 0 ? `M50 ${50 - r} A${r} ${r} 0 1 1 49.99 ${50 - r}` : '');
    const lapMin = laps * config.dial_max;
    root.querySelector('.laps').textContent = laps > 0 ? (lapMin % 60 === 0 ? `+${lapMin / 60}h` : `+${lapMin}m`) : '';
    root.querySelector('.status').textContent = on ? 'ON' : entity.state === 'off' ? 'OFF' : entity.state.toUpperCase();
    const autoOff = parseHms(this._s(config.auto_shutdown)?.state);
    let sub = '';
    if (this._dragging || (!on && this._selected > 0)) { const m = Math.round(this._selected); sub = m >= 60 ? `Timer: ${Math.floor(m / 60)}:${pad(m % 60)} hours` : `Timer: ${m} minutes`; }
    else if (on && remaining !== undefined) sub = `Time left ${clock(remaining)}`;
    else if (on) sub = 'Until auto shutdown';
    root.querySelector('.status-sub').textContent = sub;
    root.querySelector('.auto').textContent = hoursText(autoOff);
    root.querySelector('.amps').textContent = `${Number(this._s(config.current)?.state ?? 0).toFixed(1)} A`;
    const watts = Number(this._s(config.power)?.state);
    root.querySelector('.watts').textContent = Number.isFinite(watts) ? `${Math.round(watts)} W` : '—';
    root.querySelector('[data-entity="power"]').hidden = !config.power;
    const temp = Number(this._s(config.temperature)?.state);
    root.querySelector('.temp').textContent = Number.isFinite(temp) ? `${temp.toFixed(1)} °C` : '—';
    root.querySelector('[data-entity="temperature"]').hidden = !config.temperature;
    const value = autoOff !== undefined ? `${pad(Math.floor(autoOff / 3600))}:${pad(Math.floor((autoOff % 3600) / 60))}` : '';
    const select = root.querySelector('.shutdown select');
    if (select.dataset.value !== value) {
      select.dataset.value = value;
      const options = [...new Set([...config.auto_off_options, value].filter(Boolean))].sort();
      select.innerHTML = options.map((option) => `<option value="${option}"${option === value ? ' selected' : ''}>${hoursText(parseHms(option))}</option>`).join('');
    }
  }

  /* ---------- Schedule (Scheduler integration) ---------- */

  async _loadSchedules() {
    if (!this._hass?.callWS) return;
    try {
      const items = await this._hass.callWS({ type: 'scheduler' });
      this._schedules = items.filter((item) => (item.tags ?? []).includes(this._config.schedule_tag));
    } catch {
      this._schedules = undefined;
    }
    if (this._page === 'schedule' && !this._editing) this._renderSchedules();
  }

  _renderSchedules() {
    const page = this._root.querySelector('[data-page="schedule"]');
    if (this._editing) return this._renderForm(page);
    if (this._schedules === undefined) {
      page.innerHTML = '<div class="empty">The Scheduler integration is needed for schedules.</div>';
      page.onclick = null;
      return;
    }
    if (this._schedules.length === 0) {
      page.innerHTML = '<div class="center"><div class="illus"><ha-icon icon="mdi:calendar-check-outline"></ha-icon></div><h3>Schedule</h3><p class="muted">Schedule offers flexibility for timing the switchers</p><button class="primary" type="button" data-add><ha-icon icon="mdi:calendar-plus"></ha-icon>Add your first Schedule</button></div>';
    } else {
      const rows = [...this._schedules].sort((a, b) => a.timeslots[0].start.localeCompare(b.timeslots[0].start)).map((item) => {
        const slot = item.timeslots[0];
        const days = item.weekdays.includes('daily') ? 'Every day' : item.weekdays.map((d) => DAY_LABEL[d] ?? d).join(', ');
        const enabled = this._s(item.entity_id)?.state !== 'off';
        return `<div class="sched" data-id="${esc(item.schedule_id)}"><div><strong>${slot.start.slice(0, 5)}${slot.stop ? ` – ${slot.stop.slice(0, 5)}` : ''}</strong><small>${esc(days)}</small></div>
          <button class="icon-btn" type="button" data-edit aria-label="Edit"><ha-icon icon="mdi:pencil-outline"></ha-icon></button>
          <button class="toggle${enabled ? ' on' : ''}" type="button" data-toggle role="switch" aria-label="On/off" aria-checked="${enabled}"></button></div>`;
      }).join('');
      page.innerHTML = `${rows}<div class="add-row"><button class="primary" type="button" data-add><ha-icon icon="mdi:calendar-plus"></ha-icon>Add Schedule</button></div>`;
    }
    page.oninput = null;
    page.onclick = (event) => {
      if (event.target.closest('[data-add]')) {
        this._editing = { start: '06:00', stop: '06:30', days: new Set(DAYS) };
        this._renderSchedules();
        return;
      }
      const row = event.target.closest('.sched');
      const item = row && this._schedules.find((s) => s.schedule_id === row.dataset.id);
      if (!item) return;
      if (event.target.closest('[data-toggle]')) {
        const on = this._s(item.entity_id)?.state !== 'off';
        this._call('switch', on ? 'turn_off' : 'turn_on', { entity_id: item.entity_id });
        return;
      }
      if (event.target.closest('[data-edit]')) {
        const slot = item.timeslots[0];
        const days = item.weekdays.includes('daily') ? new Set(DAYS) : new Set(item.weekdays.filter((d) => DAYS.includes(d)));
        this._editing = { item, start: slot.start.slice(0, 5), stop: (slot.stop ?? slot.start).slice(0, 5), days };
        this._renderSchedules();
      }
    };
  }

  _renderForm(page) {
    const edit = this._editing;
    page.innerHTML = `<div class="form"><h3 class="center" style="margin:6px 0">${edit.item ? 'Edit Schedule' : 'New Schedule'}</h3>
      <div class="times"><label>Start<input type="time" data-start value="${edit.start}"></label><label>End<input type="time" data-stop value="${edit.stop}"></label></div>
      <div class="days">${DAYS.map((d) => `<button type="button" data-day="${d}" class="${edit.days.has(d) ? 'on' : ''}" aria-pressed="${edit.days.has(d)}">${DAY_LABEL[d]}</button>`).join('')}</div>
      <div class="actions"><button class="secondary" type="button" data-cancel>Cancel</button><button class="primary" type="button" data-save>Save</button></div>
      ${edit.item ? '<div class="add-row"><button class="secondary" type="button" data-delete style="color:var(--error-color)">Delete Schedule</button></div>' : ''}</div>`;
    page.oninput = (event) => {
      if (event.target.matches('[data-start]')) edit.start = event.target.value;
      if (event.target.matches('[data-stop]')) edit.stop = event.target.value;
    };
    page.onclick = async (event) => {
      const dayButton = event.target.closest('[data-day]');
      if (dayButton) {
        const day = dayButton.dataset.day;
        if (edit.days.has(day)) edit.days.delete(day);
        else edit.days.add(day);
        dayButton.classList.toggle('on', edit.days.has(day));
        dayButton.setAttribute('aria-pressed', String(edit.days.has(day)));
        return;
      }
      if (event.target.closest('[data-cancel]')) {
        this._editing = undefined;
        this._renderSchedules();
        return;
      }
      if (event.target.closest('[data-delete]')) {
        if (!window.confirm('Delete this schedule?')) return;
        const ok = await this._hass.callApi('POST', 'scheduler/remove', { schedule_id: edit.item.schedule_id }).then(() => true, (error) => (this._err(error), false));
        if (!ok) return;
        this._editing = undefined;
        await this._loadSchedules();
        this._renderSchedules();
        return;
      }
      if (event.target.closest('[data-save]')) {
        if (!/^\d{2}:\d{2}$/.test(edit.start) || !/^\d{2}:\d{2}$/.test(edit.stop) || edit.days.size === 0) return;
        // Default: start the boiler with the Switcher's own timer for the slot length, so it switches off on time.
        const action = this._config.schedule_action ?? { service: 'switcher_kis.turn_on_with_timer', service_data: { entity_id: this._config.entity, timer_minutes: Math.max(1, Math.min(SWITCHER_TIMER_MAX, slotMinutes(edit.start, edit.stop))) } };
        const payload = {
          weekdays: edit.days.size === 7 ? ['daily'] : DAYS.filter((d) => edit.days.has(d)),
          timeslots: [{ start: `${edit.start}:00`, stop: `${edit.stop}:00`, actions: [action] }],
          repeat_type: 'repeat',
          tags: [this._config.schedule_tag],
          name: edit.item?.name ?? null,
        };
        const call = edit.item
          ? this._hass.callApi('POST', 'scheduler/edit', { ...payload, schedule_id: edit.item.schedule_id })
          : this._hass.callApi('POST', 'scheduler/add', payload);
        const ok = await call.then(() => true, (error) => (this._err(error), false));
        if (!ok) return;
        this._editing = undefined;
        await this._loadSchedules();
        this._renderSchedules();
      }
    };
  }

  /* ---------- History and costs (recorder) ---------- */

  async _runsBetween(start, end) {
    const id = this._config.entity;
    const result = await this._hass.callWS({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: [id], minimal_response: true, no_attributes: true });
    const runs = [];
    let onAt;
    for (const row of result[id] ?? []) {
      const state = row.s ?? row.state;
      const stamp = row.lc ?? row.lu;
      const when = stamp ? new Date(stamp * 1000) : new Date(row.last_changed ?? row.last_updated);
      if (state === 'on' && !onAt) onAt = when < start ? start : when;
      else if (state !== 'on' && onAt) {
        runs.push({ start: onAt, seconds: (when - onAt) / 1000 });
        onAt = undefined;
      }
    }
    if (onAt) runs.push({ start: onAt, seconds: (Math.min(Date.now(), end.getTime()) - onAt) / 1000, running: true });
    return runs.filter((run) => run.seconds >= 30);
  }

  /** Cost per kWh: `price_per_kwh`, or this month's cost divided by this month's energy. */
  _price() {
    if (this._config.price_per_kwh) return Number(this._config.price_per_kwh);
    const cost = Number(this._s(this._config.cost)?.state);
    const energy = Number(this._s(this._config.energy)?.state);
    return cost > 0 && energy > 0 ? cost / energy : undefined;
  }

  async _loadHistory() {
    this._historyLoaded = true;
    const body = this._root.querySelector('.sub-body');
    body.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const end = new Date();
      this._runs = await this._runsBetween(new Date(end.getTime() - this._config.history_days * 864e5), end);
      if (!this._from) {
        this._until = isoDay(end);
        this._from = isoDay(new Date(end.getTime() - 6 * 864e5));
      }
      this._months = await this._monthlyCosts();
    } catch (error) {
      this._runs = this._runs ?? [];
      this._err(error);
    }
    this._renderHistory();
  }

  async _monthlyCosts() {
    const statistic = this._config.energy_total ?? this._config.energy;
    const price = this._price();
    if (!statistic || !price) return [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const stats = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: start.toISOString(), statistic_ids: [statistic], period: 'month', types: ['change'] });
    const rows = stats[statistic] ?? [];
    return [0, 1, 2].map((offset) => {
      const month = new Date(now.getFullYear(), now.getMonth() - 2 + offset, 1);
      const row = rows.find((r) => {
        const d = new Date(r.start);
        return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
      });
      return { label: month.toLocaleString('en', { month: 'long' }), cost: Math.max(0, row?.change ?? 0) * price, now: offset === 2 };
    });
  }

  async _renderCosts(body) {
    const from = new Date(`${this._from}T00:00:00`);
    const until = new Date(`${this._until}T23:59:59`);
    let seconds = 0;
    let cost;
    try {
      const runs = await this._runsBetween(from, until);
      seconds = runs.reduce((sum, run) => sum + run.seconds, 0);
      const statistic = this._config.energy_total ?? this._config.energy;
      const price = this._price();
      if (statistic && price) {
        const stats = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: from.toISOString(), end_time: until.toISOString(), statistic_ids: [statistic], period: 'hour', types: ['change'] });
        cost = (stats[statistic] ?? []).reduce((sum, row) => sum + Math.max(0, row.change ?? 0), 0) * price;
      }
    } catch (error) {
      this._err(error);
    }
    if (this._sub !== 'costs') return;
    const months = this._months ?? [];
    const max = Math.max(...months.map((m) => m.cost), 0.01);
    body.classList.add('costs');
    body.innerHTML = `<div class="range"><label>From<input type="date" data-from value="${this._from}"></label><i></i><label>Until<input type="date" data-until value="${this._until}"></label></div>
      <div class="panel"><div class="line"><ha-icon icon="mdi:clock-outline"></ha-icon><div><div class="muted">hours of consumption</div><div class="value">${hoursText(seconds)}</div></div></div>
      <div class="line"><ha-icon icon="mdi:cash-multiple"></ha-icon><div><div class="muted">Cost of electricity consumption</div><div class="value">${cost === undefined ? '—' : `${cost.toFixed(2)} ₪`}</div></div></div></div>
      ${months.length ? `<div class="panel chart"><h4>Comparing with Previous Months</h4><div class="bars">${months.map((m) => `<div class="${m.now ? 'now' : ''}"><em>ILS ${m.cost.toFixed(2)}</em><span style="height:${Math.max(2, Math.round((m.cost / max) * 76))}px"></span></div>`).join('')}</div><div class="months">${months.map((m) => `<span>${m.label}</span>`).join('')}</div></div>` : ''}`;
    body.onchange = (event) => {
      if (event.target.matches('[data-from]')) this._from = event.target.value;
      if (event.target.matches('[data-until]')) this._until = event.target.value;
      if (this._from && this._until) this._renderCosts(body);
    };
  }

  _renderHistory() {
    const body = this._root.querySelector('.sub-body');
    body.onchange = null;
    body.classList.remove('costs');
    if (this._sub === 'costs') {
      this._renderCosts(body);
      return;
    }
    const runs = [...(this._runs ?? [])].sort((a, b) => b.start - a.start);
    if (!runs.length) {
      body.innerHTML = `<div class="empty">No runs in the last ${this._config.history_days} days</div>`;
      return;
    }
    const longest = Math.max(...runs.map((run) => run.seconds), 60);
    const days = new Map();
    for (const run of runs) {
      const key = isoDay(run.start);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(run);
    }
    body.innerHTML = [...days.values()].map((list) => {
      const date = list[0].start;
      const head = `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${date.toLocaleDateString('en', { weekday: 'long' })}`;
      return `<div class="day"><h4>${head}</h4>${list.map((run) => `<div class="run"><span>${pad(run.start.getHours())}:${pad(run.start.getMinutes())}</span><div class="bar"><span style="width:${Math.max(4, (run.seconds / longest) * 75)}%"></span><b>${Math.round(run.seconds / 60)} Min${run.running ? ' …' : ''}</b></div></div>`).join('')}</div>`;
    }).join('');
  }
}


const SB_ENT = (domain) => ({ entity: { domain } });
const SB_SCHEMA = [
  { name: 'entity', required: true, selector: SB_ENT('switch') },
  { name: 'name', selector: { text: {} } },
  { type: 'grid', name: '', schema: [
    { name: 'temperature', selector: SB_ENT('sensor') },
    { name: 'current', selector: SB_ENT('sensor') },
    { name: 'power', selector: SB_ENT('sensor') },
    { name: 'remaining', selector: SB_ENT('sensor') },
    { name: 'auto_shutdown', selector: SB_ENT('sensor') },
    { name: 'energy', selector: SB_ENT('sensor') },
    { name: 'energy_total', selector: SB_ENT('sensor') },
    { name: 'cost', selector: SB_ENT('sensor') },
  ] },
  { type: 'grid', name: '', schema: [
    { name: 'timer', selector: SB_ENT('timer') },
    { name: 'run_script', selector: SB_ENT('script') },
    { name: 'off_script', selector: SB_ENT('script') },
    { name: 'schedule_tag', selector: { text: {} } },
    { name: 'price_per_kwh', selector: { number: { min: 0, step: 0.0001, mode: 'box' } } },
    { name: 'dial_max', selector: { number: { min: 10, max: 180, step: 5, mode: 'box', unit_of_measurement: 'min' } } },
    { name: 'max_minutes', selector: { number: { min: 5, max: 1440, step: 5, mode: 'box', unit_of_measurement: 'min' } } },
    { name: 'history_days', selector: { number: { min: 1, max: 90, step: 1, mode: 'box' } } },
  ] },
];
const SB_LABELS = { entity: 'Boiler switch', name: 'Name', temperature: 'Water temperature sensor', current: 'Current sensor (A)', power: 'Power sensor (W)', remaining: 'Remaining time sensor', auto_shutdown: 'Auto shutdown sensor', energy: 'Energy sensor (monthly)', energy_total: 'Energy sensor (total)', cost: 'Cost sensor', timer: 'Timer', run_script: 'Run script', off_script: 'Off script', schedule_tag: 'Schedule tag', price_per_kwh: 'Price per kWh', dial_max: 'Minutes per dial turn', max_minutes: 'Longest timer (default: Auto Shutdown)', history_days: 'History days' };
class SwitcherBoilerCardEditor extends HTMLElement {
  setConfig(config) { this._config = { ...config }; this._render(); }
  set hass(hass) { this._hass = hass; this._render(); }
  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (s) => SB_LABELS[s.name] || s.name;
      this._form.addEventListener('value-changed', (ev) => {
        const value = { ...ev.detail.value };
        Object.keys(value).forEach(k => { if (value[k] === '' || value[k] === undefined || value[k] === null) delete value[k]; });
        this._config = { ...this._config, ...value };
        Object.keys(this._config).forEach(k => { if (k in SB_LABELS && !(k in value)) delete this._config[k]; });
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = SB_SCHEMA;
    this._form.data = this._config;
  }
}
if (!customElements.get('switcher-boiler-card-editor')) customElements.define('switcher-boiler-card-editor', SwitcherBoilerCardEditor);

if (!customElements.get('switcher-boiler-card')) {
  customElements.define('switcher-boiler-card', SwitcherBoilerCard);
  console.info(`%c SWITCHER-BOILER-CARD %c v${CARD_VERSION} `, 'color:#fff;background:#ec6650;font-weight:700;border-radius:4px 0 0 4px', 'color:#ec6650;font-weight:700');
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'switcher-boiler-card', name: 'Switcher Boiler Card', description: 'Home, Schedule and History screens of the Switcher app for a Switcher water heater', preview: true, documentationURL: 'https://github.com/matanmesika/switcher-boiler-card' });
}
