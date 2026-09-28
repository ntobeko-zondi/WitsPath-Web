'use strict';

// Import the Android app's interface strings for the website.
//
//   node scripts/import-android-strings.js <path-to-android>/app/src/main/res
//
// Writes public/i18n/{en,zu,st,tn,xh,af}.json. Re-run whenever the Android
// strings change. Conversions:
//   - Android escapes (\' \" \n \@ \?) and XML entities are decoded
//   - %s / %d / %1$s placeholders become {0}, {1}, ...
//   - ALL-CAPS button labels (an Android style choice, e.g. "LOG IN") become
//     sentence case, which reads better and isn't spelled out by screen readers
//   - translatable="false" strings are skipped
//
// These are interface labels only. Directions and live-trip status lines are
// never taken from here: they come from verified phrase_templates.

const fs = require('fs');
const path = require('path');

const LANGUAGES = { en: ['values', 'values-en'], zu: ['values-zu'], st: ['values-st'], tn: ['values-tn'], xh: ['values-xh'], af: ['values-af'] };
const OUT_DIR = path.resolve(__dirname, '..', '..', 'public', 'i18n');

function decode(raw) {
  let placeholder = 0;
  return raw
    .replace(/%(\d+\$)?[sd]/g, () => `{${placeholder++}}`)
    .replace(/\\n/g, '\n')
    .replace(/\\(['"@?\\])/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function sentenceCase(text) {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2 || letters !== letters.toLocaleUpperCase()) return text;
  const lower = text.toLocaleLowerCase();
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

function readStrings(file) {
  if (!fs.existsSync(file)) return {};
  const xml = fs.readFileSync(file, 'utf8');
  const strings = {};
  for (const match of xml.matchAll(/<string\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/string>/g)) {
    const [, name, attrs, raw] = match;
    if (/translatable\s*=\s*"false"/.test(attrs)) continue;
    strings[name] = sentenceCase(decode(raw));
  }
  return strings;
}

function main() {
  const resDir = process.argv[2];
  if (!resDir || !fs.existsSync(path.join(resDir, 'values', 'strings.xml'))) {
    console.error('Usage: node scripts/import-android-strings.js <android-project>/app/src/main/res');
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [lang, dirs] of Object.entries(LANGUAGES)) {
    const strings = Object.assign({}, ...dirs.map((dir) => readStrings(path.join(resDir, dir, 'strings.xml'))));
    const sorted = Object.fromEntries(Object.keys(strings).sort().map((key) => [key, strings[key]]));
    const file = {
      _meta: {
        source: 'WitsPath Android app res/' + dirs.join(' + ') + '/strings.xml',
        importedAt: new Date().toISOString().slice(0, 10),
        // Nobody has confirmed who reviewed the Android translations.
        reviewed: lang === 'en'
      },
      ...sorted
    };
    fs.writeFileSync(path.join(OUT_DIR, `${lang}.json`), JSON.stringify(file, null, 2) + '\n');
    console.log(`${lang}: ${Object.keys(sorted).length} strings`);
  }
}

main();
