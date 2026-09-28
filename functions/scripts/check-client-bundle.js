'use strict';

// Test case 8: confirm no Anthropic (or Vulavula) credential can reach the
// browser. Scans every file Firebase Hosting would publish (same rules as
// firebase.json) and fails if it finds a key pattern or the real key value.
//
//   node scripts/check-client-bundle.js [https://your-site.web.app]
//
// With a URL it also fetches the deployed index page and every script and
// stylesheet it references.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const hosting = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'firebase.json'), 'utf8')).hosting;
// Firebase Hosting publishes this folder (public/).
const SITE_ROOT = path.join(REPO_ROOT, hosting.public);

// Load local secrets (if any) so the actual key values are searched for too.
for (const file of ['.secret.local', '.env']) {
  const full = path.join(__dirname, '..', file);
  if (fs.existsSync(full)) process.loadEnvFile(full);
}

const PATTERNS = [/sk-ant-[A-Za-z0-9_-]{8,}/, /ANTHROPIC_API_KEY/, /VULAVULA_API_KEY/, /X-CLIENT-TOKEN/i, /x-api-key/i];
const SECRET_VALUES = [process.env.ANTHROPIC_API_KEY, process.env.VULAVULA_API_KEY, process.env.ADMIN_API_TOKEN].filter(
  (value) => value && value.length > 8
);

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*');
  return new RegExp(`^${pattern}$`);
}
const ignore = hosting.ignore.map(globToRegExp);

function publishedFiles(dir = SITE_ROOT) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(SITE_ROOT, full).split(path.sep).join('/');
    if (ignore.some((pattern) => pattern.test(relative) || pattern.test(`${relative}/`))) continue;
    if (entry.isDirectory()) files.push(...publishedFiles(full));
    else files.push({ name: relative, content: fs.readFileSync(full, 'utf8') });
  }
  return files;
}

async function deployedFiles(baseUrl) {
  const index = await (await fetch(baseUrl)).text();
  const assets = [...index.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => new URL(match[1], baseUrl).href);
  const files = [{ name: baseUrl, content: index }];
  for (const url of assets) files.push({ name: url, content: await (await fetch(url)).text() });
  return files;
}

function scan(files) {
  const problems = [];
  for (const file of files) {
    for (const pattern of PATTERNS) {
      if (pattern.test(file.content)) problems.push(`${file.name}: matches ${pattern}`);
    }
    for (const secret of SECRET_VALUES) {
      if (file.content.includes(secret)) problems.push(`${file.name}: contains a real secret value`);
    }
  }
  return problems;
}

async function main() {
  const files = publishedFiles();
  const leakedServerFiles = files.filter((file) => /^(functions\/|\.env|.*\.local$)/.test(file.name));
  const problems = scan(files).concat(leakedServerFiles.map((file) => `${file.name}: server file would be published`));

  if (process.argv[2]) problems.push(...scan(await deployedFiles(process.argv[2])));

  console.log(`Scanned ${files.length} publishable files${process.argv[2] ? ` + deployed site ${process.argv[2]}` : ''}.`);
  console.log(`Checked for real key values: ${SECRET_VALUES.length ? 'yes' : 'no (none configured locally)'}.`);
  if (problems.length) {
    console.error('FAIL - possible credential exposure:\n' + problems.map((problem) => `  ${problem}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('PASS - no credentials found in client-served files.');
  }
}

main();
