// Offline only: compare the reviewed baseline and validate shell syntax. Never execute deployment.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const yaml = require(process.env.TUNNEL_YAML_MODULE || 'yaml');
const root = path.resolve(__dirname, '..').replaceAll('\\', '/');
const baselineCommit = '471dd0cb9a097d00f5a574f9ea01eb7fcd6594a4';
const baseline = yaml.parse(execFileSync('git', ['-c', 'safe.directory='+root, '-C', root, 'show', baselineCommit+':.github/workflows/deploy.yml'], {encoding:'utf8'}));
const candidate = yaml.parse(fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8'));
const {jobs:oldJobs,...oldWorkflow}=baseline;
const {jobs:newJobs,...newWorkflow}=candidate;
assert.deepEqual(oldWorkflow,newWorkflow,'Trigger/permissions/concurrency must not change');
assert.deepEqual(Object.keys(oldJobs),Object.keys(newJobs));
const key=Object.keys(oldJobs)[0];
const {steps:oldSteps,...oldJob}=oldJobs[key];
const {steps:newSteps,...newJob}=newJobs[key];
assert.deepEqual(oldJob,newJob);
const i=oldSteps.findIndex(s=>s.uses?.startsWith('appleboy/ssh-action@'));
assert.equal(i,oldSteps.length-1);
assert.deepEqual(oldSteps.slice(0,i),newSteps.slice(0,i),'Build steps must not change');
assert.equal(newSteps.length,oldSteps.length+2);
const [prepare,deploy,cleanup]=newSteps.slice(i);
const cloudflareEnvironmentBlock = [
 'CLOUDFLARE_ANALYTICS_ENABLED=true',
 'CLOUDFLARE_ACCOUNT_ID=${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
 'CLOUDFLARE_ANALYTICS_API_TOKEN=${{ secrets.CLOUDFLARE_ANALYTICS_API_TOKEN }}',
 'CLOUDFLARE_PLAN_LABEL=Workers Paid',
 'CLOUDFLARE_BILLING_CYCLE_DAY=29',
 'CLOUDFLARE_WORKERS_REQUEST_INCLUDED=10000000',
 'CLOUDFLARE_D1_ROWS_READ_INCLUDED=25000000000',
 'CLOUDFLARE_R2_STORAGE_BYTE_INCLUDED=10000000000',
 'CLOUDFLARE_DASHBOARD_URL=https://dash.cloudflare.com/${{ secrets.CLOUDFLARE_ACCOUNT_ID }}'
].join('\n');
let reviewedDeployment = deploy.env.DEPLOY_SCRIPT;
// Exact new blocks are pinned separately; disabling the flag must preserve the prior deployment.
const hostBlocks = JSON.parse(fs.readFileSync(path.join(root,'scripts/host-monitor-deployment-blocks.json'),'utf8'));
for (const [name, expected] of Object.entries(hostBlocks)) {
 const actual = reviewedDeployment.match(new RegExp('# BEGIN OPTIONAL HOST MONITOR '+name+'\\n[\\s\\S]*?# END OPTIONAL HOST MONITOR '+name+'\\n\\n','g'));
 assert.deepEqual(actual,[expected], 'Host monitor '+name+' block must match reviewed commands');
 reviewedDeployment=reviewedDeployment.replace(expected,'');
}
assert.equal(reviewedDeployment.split('    # HOST_MONITOR_READ_ONLY_VOLUME\n').length-1,1);
reviewedDeployment=reviewedDeployment.replace('    # HOST_MONITOR_READ_ONLY_VOLUME\n','');
assert.equal(reviewedDeployment.split(cloudflareEnvironmentBlock).length-1,1,
 'The reviewed Cloudflare environment block must appear exactly once');
assert.ok(!/GOOGLE_ANALYTICS|GA4_|Google Analytics|run\/secrets\/ga4/.test(reviewedDeployment),
 'Google Analytics credentials and runtime settings must be absent');
assert.equal(reviewedDeployment.split('rm -f -- ga4-service-account.json').length-1,1,
 'The obsolete local service-account file must be removed exactly once');
reviewedDeployment = reviewedDeployment
 .replace(cloudflareEnvironmentBlock+'\n','')
 .replace('rm -f -- ga4-service-account.json\n\n','');
assert.equal(reviewedDeployment,oldSteps[i].with.script,
 'Remote deployment commands beyond the reviewed Cloudflare block and credential cleanup must be identical');
assert.equal(cleanup.if,'always()');
assert.equal(deploy.env.TUNNEL_SERVICE_TOKEN_ID,'${{ secrets.TUNNEL_DEPLOY_ACCESS_CLIENT_ID }}');
assert.equal(deploy.env.TUNNEL_SERVICE_TOKEN_SECRET,'${{ secrets.TUNNEL_DEPLOY_ACCESS_CLIENT_SECRET }}');
assert.equal(deploy.env.DEPLOY_SSH_KEY,'${{ secrets.MINI_PC_KEY }}');
assert.equal(deploy.env.TUNNEL_KNOWN_HOSTS,'${{ secrets.TUNNEL_DEPLOY_SSH_KNOWN_HOSTS }}');
assert.equal(deploy.env.TUNNEL_SSH_HOST,'${{ vars.TUNNEL_DEPLOY_SSH_HOST }}');
assert.equal(deploy.env.TUNNEL_SSH_USER,'${{ secrets.MINI_PC_USERNAME }}');
assert.equal(Object.keys(deploy.env).length,7);
assert.match(prepare.run,/660b348d473bba81997445b534e7eaefaf4c4e16331866922326c338a7013dd9/);
assert.match(prepare.run,/sha256sum -c -/);
assert.match(prepare.run,/--proto-redir '=https'/);
for(const guard of ['StrictHostKeyChecking=yes','BatchMode=yes','IdentitiesOnly=yes','HostKeyAlgorithms=ssh-ed25519','ForwardAgent=no','ClearAllForwardings=yes','timeout 10m ssh','bash -n','ssh-deploy.geupddong.com','umask 077']) assert.ok(deploy.run.includes(guard),'Missing guard '+guard);
assert.ok(!/set -x|ssh-keyscan|StrictHostKeyChecking=no|--retry/.test(deploy.run));
for(const script of [...newSteps.filter(s=>s.run).map(s=>s.run),deploy.env.DEPLOY_SCRIPT]){
 const check=spawnSync(process.env.TUNNEL_BASH || 'bash',['-n'],{input:script,encoding:'utf8',timeout:10000});
 assert.equal(check.status,0,check.stderr || String(check.error));
}
console.log('PASS: baseline '+baselineCommit+'; reviewed Cloudflare settings present; Google Analytics settings removed; all other remote commands unchanged; pinned transport and shell syntax verified.');
console.log('No credentials, SSH, image push, or deployment executed.');
