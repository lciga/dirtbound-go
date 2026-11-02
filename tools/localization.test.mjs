import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import source from '../web/js/locales/fr.js';
import ru from '../web/js/locales/ru.js';
import { lang, LANGS, FALLBACK, t, serverText } from '../web/js/i18n.js';

test('Russian covers every original interface key and preserves placeholders', () => {
 const check = (original, translated, path = '') => {
  for (const [key, value] of Object.entries(original)) {
   const name = path + '.' + key;
   assert.notEqual(translated?.[key], undefined, name);
   if (value && typeof value === 'object' && !Array.isArray(value)) check(value, translated[key], name);
   else {
    const tokens = text => [...new Set(JSON.stringify(text).match(/\{\w+\}/g) || [])].sort();
    assert.deepEqual(tokens(translated[key]), tokens(value), name);
   }
  }
 };
 check(source, ru);
});

test('daily challenges, online plurals and legacy errors are Russian', () => {
 assert.equal(lang, 'ru'); assert.equal(FALLBACK, 'ru'); assert.equal(LANGS.fr, undefined);
 assert.equal(t('home.daily'), 'Испытание дня');
 assert.equal(t('home.onlineNow', {n: 1}), '1 игрок в сети');
 assert.equal(t('home.onlineNow', {n: 3}), '3 игрока в сети');
 assert.equal(t('home.onlineNow', {n: 12}), '12 игроков в сети');
 assert.equal(serverText('Connexion perdue'), 'Соединение потеряно');
});

test('an old French preference or French browser cannot restore French captions', () => {
 const result = spawnSync(process.execPath, ['--input-type=module'], {encoding: 'utf8', input: `
  globalThis.window = {};
  globalThis.document = {documentElement: {}};
  globalThis.location = {search: '?lang=fr'};
  globalThis.localStorage = {getItem: () => 'fr'};
  Object.defineProperty(globalThis, 'navigator', {value: {languages: ['fr-FR'], language: 'fr-FR'}, configurable: true});
  const {lang,t} = await import(${JSON.stringify(new URL('../web/js/i18n.js', import.meta.url).href)});
  if (lang !== 'ru' || t('home.daily') !== 'Испытание дня') process.exit(1);
 `});
 assert.equal(result.status, 0, result.stderr);
});

test('initial page markup and editor captions do not flash French while loading', async () => {
 for (const name of ['index', 'play', 'editor']) {
  const html = await fs.readFile(new URL(`../web/${name}.html`, import.meta.url), 'utf8');
  assert.match(html, /<html lang="ru"/);
  assert.doesNotMatch(html, /Jeu de course et de rallye|Des voitures de rallye|>Éditeur de circuit<|>Mes circuits<|>Enregistrer<|>Se connecter<|content: ' coupé'/);
 }
});
