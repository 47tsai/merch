import fs from 'node:fs';

const r2Entry = fs.readFileSync('worker/src/r2-entry.ts', 'utf8');
const worker = fs.readFileSync('worker/src/index.ts', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');

const outerPut = r2Entry.indexOf("if (path && (request.method === 'PUT' || request.method === 'DELETE'))");
const outerAuth = r2Entry.indexOf('if (!authorized(request, env))', outerPut);
const outerMutation = r2Entry.indexOf('mirrorPut(request, env, path)', outerPut);
const outerDelete = r2Entry.indexOf('mirrorDelete(request, env, path)', outerPut);
if (outerPut < 0 || outerAuth < outerPut || outerMutation < outerAuth || outerDelete < outerAuth) {
  throw new Error('R2 image mutations must be authorized before mirrorPut/mirrorDelete can access R2.');
}
if (!r2Entry.includes('return corsResponse(errorResponse(\'UNAUTHORIZED\', \'需要管理員權限。\', 401), origin)')) {
  throw new Error('Unauthorized R2 image mutations must return a CORS-enabled 401 response.');
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

console.log('Worker boundary and deployment gate checks passed.');
