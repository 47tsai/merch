import fs from 'node:fs';

const r2Entry = fs.readFileSync('worker/src/r2-entry.ts', 'utf8');
const worker = fs.readFileSync('worker/src/index.ts', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const verifyWorkflow = fs.readFileSync('.github/workflows/verify.yml', 'utf8');
const oauthCallback = fs.readFileSync('public/oauth-callback.html', 'utf8');

const outerPut = r2Entry.indexOf("if (path && (request.method === 'PUT' || request.method === 'DELETE'))");
const outerAuth = r2Entry.indexOf('if (!(await authorized(request, env)))', outerPut);
const outerMutation = r2Entry.indexOf('mirrorPut(request, env, path)', outerPut);
const outerDelete = r2Entry.indexOf('mirrorDelete(request, env, path)', outerPut);
if (outerPut < 0 || outerAuth < outerPut || outerMutation < outerAuth || outerDelete < outerAuth) {
  throw new Error('R2 image mutations must be authorized before mirrorPut/mirrorDelete can access R2.');
}
if (!r2Entry.includes('UNAUTHORIZED') || !r2Entry.includes('401), origin)')) {
  throw new Error('Unauthorized R2 image mutations must return a CORS-enabled 401 response.');
}
if (!verifyWorkflow.includes('contents: read') || verifyWorkflow.includes('contents: write')) {
  throw new Error('Verify workflow should use read-only contents permissions.');
}
if (!worker.includes('status === 204 || status === 304 ? null : JSON.stringify(body)')) {
  throw new Error('204/304 responses must be created without a response body.');
}
if (!deploy.includes('target_sha="${{ github.sha }}"') ||
    !deploy.includes('head_sha == $sha and .head_branch == "main"') ||
    !deploy.includes('echo "verified=false" >> "$GITHUB_OUTPUT"')) {
  throw new Error('Manual deployment must require a successful Verify run for the exact main-branch commit.');
}
const dispatchBlock = deploy.split('if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then')[1]?.split('\n          fi')[0] ?? '';
if (dispatchBlock.includes('echo "verified=true" >> "$GITHUB_OUTPUT"') && !dispatchBlock.includes('if [ "$verified" -gt 0 ]')) {
  throw new Error('Manual deployment cannot bypass the Verify success gate.');
}

const deployLines = deploy.split('\n');
if (!deployLines.includes('permissions:') ||
    !deployLines.includes('  contents: read') ||
    deployLines.includes('  pages: write') ||
    deployLines.includes('  id-token: write')) {
  throw new Error('Deploy workflow should default to read-only contents permissions.');
}
function jobSection(name) {
  const start = deployLines.findIndex(line => line === `  ${name}:`);
  if (start < 0) return '';
  let end = start + 1;
  while (end < deployLines.length && !/^  [a-z][a-z-]+:$/.test(deployLines[end])) end += 1;
  return deployLines.slice(start, end).join('\n');
}
const gate = jobSection('gate');
const build = jobSection('build');
const deployPages = jobSection('deploy');
const deployWorker = jobSection('deploy-worker');
if (!gate.includes('      actions: read')) {
  throw new Error('Gate job should receive the Actions read permission it needs.');
}
if (!deployPages.includes('      pages: write') || !deployPages.includes('      id-token: write')) {
  throw new Error('GitHub Pages deploy job must explicitly request Pages write and OIDC permissions.');
}
if (/pages: write|id-token: write/.test(gate + build + deployWorker)) {
  throw new Error('Pages write and OIDC permissions must not be granted to gate, build, or Worker deployment jobs.');
}

if (!deploy.includes('npx wrangler@4.151.0') || /npx wrangler@4(?:\s|$)/.test(deploy)) {
  throw new Error('Worker deployment must use the explicitly pinned Wrangler CLI version.');
}

if (deploy.includes('ADMIN_SECRET') || deploy.includes('MERCH_ADMIN_SECRET')) {
  throw new Error('Deployment must not require the legacy admin secret after Chi Auth migration.');
}
const wranglerConfig = fs.readFileSync('worker/wrangler.toml', 'utf8');
if (!wranglerConfig.includes('CHI_AUTH_CLIENT_ID = "T4sJJ0exZ0iiqaL5nrjUly-RU-KgoVp0"') ||
    !deploy.includes('Chi Auth client ID is supplied by wrangler.toml.') ||
    deploy.includes('secret put CHI_AUTH_CLIENT_ID')) {
  throw new Error('Deployment must configure the public Chi Auth OAuth client ID through Wrangler vars, not as a secret.');
}

if (!oauthCallback.includes("tokenUrl.searchParams.set('client_id', cfg.clientId)") || !oauthCallback.includes("fetch(tokenUrl.toString()")) {
  throw new Error('Chi Auth token exchange must include client_id in the URL so the CORS preflight can resolve the registered client.');
}

console.log('Worker boundary, deployment gate, job permission, and Wrangler pin checks passed.');
