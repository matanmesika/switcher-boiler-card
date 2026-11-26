// Node unit tests for the shipped card file (no browser needed).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = new Map();
class FakeElement {
  attachShadow() { this.shadowRoot = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }; return this.shadowRoot; }
  appendChild() {} addEventListener() {} dispatchEvent(e) { (this.events ||= []).push(e); return true; }
}
const context = vm.createContext({
  HTMLElement: FakeElement, console: { info() {} }, window: {}, document: { createElement: (n) => new (elements.get(n) || FakeElement)() },
  customElements: { get: (n) => elements.get(n), define: (n, c) => elements.set(n, c) },
  CustomEvent: class { constructor(type, o) { this.type = type; Object.assign(this, o); } }, setTimeout, clearTimeout,
});
const source = fs.readFileSync(path.join(__dirname, '../dist/switcher-boiler-card.js'), 'utf8');
vm.runInContext(source, context);
const get = (name) => vm.runInContext(name, context);

const hass = {
  states: {
    'switch.boiler': { state: 'off', attributes: {} },
    'sensor.boiler_power': { state: '0', attributes: { device_class: 'power', unit_of_measurement: 'W' } },
    'sensor.boiler_current': { state: '0.0', attributes: { device_class: 'current', unit_of_measurement: 'A' } },
    'sensor.boiler_remaining_time': { state: '00:00:00', attributes: {} },
    'sensor.boiler_auto_shutdown': { state: '03:00:00', attributes: {} },
    'sensor.other_power': { state: '5', attributes: { device_class: 'power' } },
  },
  entities: {
    'switch.boiler': { entity_id: 'switch.boiler', device_id: 'sw', platform: 'switcher_kis' },
    'sensor.boiler_power': { entity_id: 'sensor.boiler_power', device_id: 'sw', platform: 'switcher_kis' },
    'sensor.boiler_current': { entity_id: 'sensor.boiler_current', device_id: 'sw', platform: 'switcher_kis' },
    'sensor.boiler_remaining_time': { entity_id: 'sensor.boiler_remaining_time', device_id: 'sw', platform: 'switcher_kis', translation_key: 'remaining_time' },
    'sensor.boiler_auto_shutdown': { entity_id: 'sensor.boiler_auto_shutdown', device_id: 'sw', platform: 'switcher_kis', translation_key: 'auto_shutdown' },
    'sensor.other_power': { entity_id: 'sensor.other_power', device_id: 'other', platform: 'x' },
  },
};

test('automatic setup finds the Switcher sensors on the same device only', () => {
  assert.deepEqual({ ...get('detectSwitcher')(hass, 'switch.boiler') }, {
    power: 'sensor.boiler_power', current: 'sensor.boiler_current',
    remaining: 'sensor.boiler_remaining_time', auto_shutdown: 'sensor.boiler_auto_shutdown',
  });
  assert.deepEqual({ ...get('detectSwitcher')(hass, 'switch.unknown') }, {});
});

test('manual sensors always win over detected ones', () => {
  const card = new (elements.get('switcher-boiler-card'))();
  card._build = () => { card._built = true; }; card._renderHome = () => {}; card._loadSchedules = () => {};
  card.setConfig({ entity: 'switch.boiler', power: 'sensor.my_power' });
  card.hass = hass;
  assert.equal(card._config.power, 'sensor.my_power');
  assert.equal(card._config.current, 'sensor.boiler_current');
  assert.equal(card._config.auto_shutdown, 'sensor.boiler_auto_shutdown');
});

test('timer limit follows Auto Shutdown and the 150-minute service limit without scripts', () => {
  const card = new (elements.get('switcher-boiler-card'))();
  card._hass = hass;
  card.setConfig({ entity: 'switch.boiler', auto_shutdown: 'sensor.boiler_auto_shutdown' });
  assert.equal(card._limit(), 150);
  card.setConfig({ entity: 'switch.boiler', auto_shutdown: 'sensor.boiler_auto_shutdown', run_script: 'script.run' });
  assert.equal(card._limit(), 180);
  card.setConfig({ entity: 'switch.boiler', max_minutes: 240, run_script: 'script.run' });
  assert.equal(card._limit(), 240);
});

test('schedule slot length crosses midnight', () => {
  const minutes = get('slotMinutes');
  assert.equal(minutes('06:00', '06:45'), 45);
  assert.equal(minutes('23:30', '00:15'), 45);
});

test('stub config prefers a switcher_kis switch and the card registers itself', () => {
  assert.equal(elements.get('switcher-boiler-card').getStubConfig(hass).entity, 'switch.boiler');
  assert.ok(elements.get('switcher-boiler-card-editor'));
  assert.equal(context.window.customCards[0].type, 'switcher-boiler-card');
});

test('entity is required', () => {
  const card = new (elements.get('switcher-boiler-card'))();
  assert.throws(() => card.setConfig({}), /entity is required/);
});

test('editor drops cleared fields and reports the new config', () => {
  const editor = new (elements.get('switcher-boiler-card-editor'))();
  editor._render = () => {};
  editor.setConfig({ entity: 'switch.boiler', power: 'sensor.boiler_power' });
  editor._config = { entity: 'switch.boiler', power: 'sensor.boiler_power' };
  assert.equal(typeof get('SB_SCHEMA').length, 'number');
  const names = JSON.stringify(get('SB_SCHEMA'));
  for (const key of ['entity', 'temperature', 'current', 'power', 'remaining', 'auto_shutdown', 'energy', 'cost', 'timer', 'run_script', 'off_script', 'max_minutes']) {
    assert.match(names, new RegExp(`"name":"${key}"`), key);
  }
});

test('only overflowing sections scroll; the home page never does and costs stay compact', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../dist/switcher-boiler-card.js'), 'utf8');
  assert.match(src, /\.page \{[^}]*overflow: hidden;/);
  assert.match(src, /\.sub-body \{[^}]*overflow-y: auto;/);
  assert.match(src, /\.costs \.bars \{ height: 104px;/);
});
