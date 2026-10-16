import fs from 'node:fs';

const r2Entry = fs.readFileSync('worker/src/r2-entry.ts', 'utf8');
const worker = fs.readFileSync('worker/src/index.ts', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const verifyWorkflow = fs.readFileSync('.github/workflows/verify.yml', 'utf8');

const outerPut = r2Entry.indexOf("if (path && (request.method === 'PUT' || request.method === 'DELETE'))");
const outerAuth = r2Entry.indexOf('if (!authorized(request, env))', outerPut);
const outerMutation = r2Entry.indexOf('mirrorPut(request, env, path)', outerPut);
const outerDelete = r2Entry.indexOf('mirrorDelete(request, env, path)', outerPut);
if (outerPut < 0 || outerAuth < outerPut || outerMutation < outerAuth || outerDelete < outerAuth) {
  throw new Error('R2 image mutations must be authorized before mirrorPut/mirrorDelete can access R2.');
}
if (!r2Entry.includes('return corsResponse(errorResponse(\\'UNAUTHORIZED\\', \\'需要管理員權限。\\', 401), origin)')) {
  throw new Error('Unauthorized R2 image mutations must return a CORS-enabled 401 response.');
}
if (!verifyWorkflow.includes('contents: read') || /permissions:\\s*\\n\\s*contents: write/.test(verifyWorkflow)) {
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
const dispatchBlock = deploy.split('if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then')[1]?.split('\\n          fi')[0] ?? '';
if (dispatchBlock.includes('echo "verified=true" >> "$GITHUB_OUTPUT"') && !dispatchBlock.includes('if [ "$verified" -gt 0 ]')) {
  throw new Error('Manual deployment cannot bypass the Verify success gate.');
}

if (!/permissions:\\n  contents: read\\n/.test(deploy)) {
  throw new Error('Deploy workflow should default to read-only repository contents permissions.');
}
const jobBlock = (name) => deploy.split(new RegExp('\\n  ' + name + ':\\n'))[1]?.split(/\\n  [a-z][a-z-]+:\\n/)[0] ?? '';
const gate = jobBlock('gate');
const build = jobBlock('build');
const deployPages = jobBlock('deploy');
const deployWorker = jobBlock('deploy-worker');
if (!/permissions:\\n      actions: read/.test(gate)) {
  throw new Error('Gate job should receive only the Actions read permission it needs.');
}
if (!/permissions:\\n      pages: write\\n      id-token: write/.test(deployPages)) {
  throw new Error('GitHub Pages deploy job must explicitly request Pages write and OIDC permissions.');
}
if (/pages: write|id-token: write/.test(gate + build + deployWorker)) {
  throw new Error('Pages write and OIDC permissions must not be granted to gate, build, or Worker deployment jobs.');
}

console.log('Worker boundary, deployment gate, and job permission checks passed.');
