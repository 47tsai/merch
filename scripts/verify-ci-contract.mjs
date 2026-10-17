import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/verify.yml', 'utf8');
const scripts = packageJson.scripts ?? {};
const verifyScripts = Object.entries(scripts)
  .filter(([name]) => name.startsWith('verify'))
  .map(([name]) => name);

const missing = verifyScripts.filter((name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !new RegExp(`npm\\s+run\\s+${escaped}(?:\\s|$)`).test(workflow);
});

if (missing.length) {
  throw new Error(`CI workflow is missing verification scripts: ${missing.join(', ')}`);
}

if (!workflow.includes('npm run build')) {
  throw new Error('CI workflow is missing the production build step.');
}

const deployWorkflow = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const workerSource = fs.readFileSync('worker/src/index.ts', 'utf8');

if (!deployWorkflow.includes('workflow_run:') || !deployWorkflow.includes('workflows: [Verify]') || !deployWorkflow.includes('types: [completed]')) {
  throw new Error('Deploy workflow must be triggered by the completed Verify workflow.');
}
if (!workflow.includes('repository_dispatch') || !workflow.includes('merch-mutation')) {
  throw new Error('Verify workflow must accept the runtime mutation dispatch event.');
}
if (!deployWorkflow.includes('github.event.workflow_run.id') || !deployWorkflow.includes('actions/runs/$run_id')) {
  throw new Error('Deploy workflow must wait for the triggering Verify run result.');
}
if (!deployWorkflow.includes('conclusion') || !deployWorkflow.includes('verified=true')) {
  throw new Error('Deploy workflow must require a successful Verify workflow.');
}
if (!deployWorkflow.includes('branches: [main]')) {
  throw new Error('Deploy workflow must be scoped to main for runtime data deployments.');
}
if (!deployWorkflow.includes('MERCH_GITHUB_TOKEN') || !deployWorkflow.includes('secret put GITHUB_TOKEN')) {
  throw new Error('Worker deploy must provision its dedicated GitHub write token.');
}
if (!workerSource.includes('createAtomicCommit') || !workerSource.includes('/git/commits') || !workerSource.includes('/git/refs/heads/') || !workerSource.includes('/dispatches') || !workerSource.includes('merch-mutation') || !workerSource.includes('[skip ci]')) {
  throw new Error('Worker mutations must create a Git commit and advance the main branch ref.');
}
for (const mutation of ['upsertShipping', 'removeShipping', 'updateItem', 'deleteItem', 'putAsset', 'deleteAsset', 'createWork', 'updateWork', 'deleteWork']) {
  const start = workerSource.indexOf(`async function ${mutation}`);
  if (start < 0 || workerSource.indexOf('createAtomicCommit', start) < 0) {
    throw new Error(`Worker mutation ${mutation} must commit through createAtomicCommit.`);
  }
}

console.log(`CI/deploy contract OK: ${verifyScripts.length} verification scripts are wired and runtime mutations have a Verify → Deploy path.`);
