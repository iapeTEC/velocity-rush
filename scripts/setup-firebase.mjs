#!/usr/bin/env node
/**
 * Configures a NEW free (Spark) Firebase project for Velocity Rush and, when CLASP is
 * available, the Apps Script ranking. Safe to run again: existing pieces are reused.
 *
 *   npx firebase login                      (once, opens the browser)
 *   node scripts/setup-firebase.mjs [projectId] [--no-ranking]
 *
 * Writes public/config.json and apps-script/Config.js. Only public identifiers are written;
 * no service-account key is created or stored.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const firebaseBin = require.resolve('firebase-tools/lib/bin/firebase.js');
const args = process.argv.slice(2);
const withRanking = !args.includes('--no-ranking');
const step = message => console.log(`\n▶ ${message}`);

function firebase(...command) {
  let output;
  try {
    output = execFileSync(process.execPath, [firebaseBin, ...command, '--json', '--non-interactive'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    output = error.stdout || '';
    if (!output.trim().startsWith('{')) throw new Error(`firebase ${command.join(' ')} falhou: ${error.stderr || error.message}`);
  }
  const reply = JSON.parse(output.slice(output.indexOf('{')));
  if (reply.status !== 'success') throw new Error(`firebase ${command.join(' ')}: ${reply.error ?? JSON.stringify(reply)}`);
  return reply.result;
}

function clasp(...command) {
  return execFileSync(process.platform === 'win32' ? 'clasp.cmd' : 'clasp', command, { cwd: join(root, 'apps-script'), encoding: 'utf8', shell: process.platform === 'win32' });
}

step('Verificando login do Firebase CLI');
const accounts = firebase('login:list');
if (!Array.isArray(accounts) || !accounts.length) {
  console.error('Nenhuma conta logada. Rode primeiro: npx firebase login');
  process.exit(1);
}

const projectId = args.find(arg => !arg.startsWith('--')) ?? `velocity-rush-${Math.random().toString(36).slice(2, 8)}`;
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error(`ID de projeto inválido: ${projectId}`);

step(`Projeto ${projectId}`);
const projects = firebase('projects:list');
if (projects.some(project => project.projectId === projectId)) console.log('  já existe; reutilizando.');
else firebase('projects:create', projectId, '--display-name', 'Velocity Rush');

step('App web');
const apps = firebase('apps:list', 'WEB', '--project', projectId);
const appId = apps.find(app => app.displayName === 'Velocity Rush')?.appId ?? firebase('apps:create', 'WEB', 'Velocity Rush', '--project', projectId).appId;
const sdk = firebase('apps:sdkconfig', 'WEB', appId, '--project', projectId);
const sdkConfig = sdk.sdkConfig ?? (typeof sdk.fileContents === 'string' ? JSON.parse(sdk.fileContents.slice(sdk.fileContents.indexOf('{'), sdk.fileContents.lastIndexOf('}') + 1)) : sdk);

step('Realtime Database');
const instance = `${projectId}-default-rtdb`;
const instances = firebase('database:instances:list', '--project', projectId);
if (!JSON.stringify(instances).includes(instance)) firebase('database:instances:create', instance, '--location', 'us-central1', '--project', projectId);
const databaseURL = sdkConfig.databaseURL || `https://${instance}.firebaseio.com`;

step('Login anônimo');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { Client } = require('firebase-tools/lib/apiv2');
const { ensure } = require('firebase-tools/lib/ensureApiEnabled');
const { identityOrigin } = require('firebase-tools/lib/api');
await requireAuth({});
await ensure(projectId, identityOrigin(), 'auth', true);
const admin = new Client({ urlPrefix: identityOrigin(), apiVersion: 'admin/v2' });
const enableAnonymous = () => admin.patch(`projects/${projectId}/config`, { signIn: { anonymous: { enabled: true } } }, { queryParams: { updateMask: 'signIn.anonymous.enabled' } });
try {
  await enableAnonymous();
} catch (error) {
  if (!String(error.message).includes('CONFIGURATION_NOT_FOUND')) throw error;
  // Fresh projects need Authentication initialized once (the console's "Get started").
  await new Client({ urlPrefix: identityOrigin(), apiVersion: 'v2' }).post(`projects/${projectId}/identityPlatform:initializeAuth`, {});
  await enableAnonymous();
}

step('Regras de segurança');
firebase('deploy', '--only', 'database', '--project', projectId);

const firebaseConfig = {
  apiKey: sdkConfig.apiKey,
  authDomain: sdkConfig.authDomain ?? `${projectId}.firebaseapp.com`,
  databaseURL,
  projectId,
  storageBucket: sdkConfig.storageBucket,
  messagingSenderId: sdkConfig.messagingSenderId,
  appId: sdkConfig.appId ?? appId,
};

let leaderboardUrl = '';
const configPath = join(root, 'public', 'config.json');
if (existsSync(configPath)) leaderboardUrl = JSON.parse(readFileSync(configPath, 'utf8')).leaderboardUrl ?? '';

if (withRanking && existsSync(join(root, 'apps-script', '.clasp.json'))) {
  step('Ranking (Apps Script)');
  writeFileSync(join(root, 'apps-script', 'Config.js'), `/* Public Firebase identifiers written by scripts/setup-firebase.mjs. Not secrets: the web app also ships them. */\nvar VR_CONFIG = {\n  FIREBASE_API_KEY: '${firebaseConfig.apiKey}',\n  FIREBASE_PROJECT_ID: '${projectId}',\n  FIREBASE_DATABASE_URL: '${databaseURL}'\n};\n`);
  clasp('push', '--force');
  const deployments = clasp('list-deployments').split('\n').map(line => line.match(/^- (\S+) @(\d+)/)).filter(Boolean);
  const deploymentId = deployments.at(-1)?.[1];
  if (deploymentId) clasp('update-deployment', deploymentId, '-d', 'Velocity Rush ranking');
  const id = deploymentId ?? clasp('create-deployment', '-d', 'Velocity Rush ranking').match(/- (\S+) @/)?.[1];
  if (id) leaderboardUrl = `https://script.google.com/macros/s/${id}/exec`;
}

writeFileSync(configPath, `${JSON.stringify({ firebase: firebaseConfig, leaderboardUrl }, null, 2)}\n`);
console.log(`\n✔ Pronto. public/config.json atualizado para ${projectId}.`);
if (leaderboardUrl) console.log(`  Ranking: ${leaderboardUrl}\n  Abra essa URL uma vez logado como dono do script para autorizar Planilhas e chamadas externas.`);
console.log('  Agora faça commit e push: o GitHub Actions publica o jogo com o modo online ativo.');
