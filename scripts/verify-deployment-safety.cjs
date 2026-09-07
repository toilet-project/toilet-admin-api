// Offline workflow/shell tests. Docker, curl, flock and sleep are test doubles.
// Only synthetic files in newly-created OS temp directories are changed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const YAML = require(process.env.DEPLOY_YAML_MODULE || 'yaml');
const bash = process.env.DEPLOY_BASH || 'bash';
const python = process.env.DEPLOY_PYTHON || 'python3';
const root = path.resolve(__dirname, '..');
const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
assert.deepEqual(workflow.permissions, {contents: 'read'});
assert.deepEqual(workflow.concurrency, {group: 'toilet-admin-production', 'cancel-in-progress': false});
assert.deepEqual(workflow.on, {push: {branches: ['main']}});
const steps = workflow.jobs['build-and-deploy'].steps;
const step = steps.find(s => s.uses?.startsWith('appleboy/ssh-action@'));
assert.ok(step, 'Existing SSH transport must remain');
assert.equal(step.with.host, '${{ secrets.MINI_PC_HOST }}');
const source = step.with.script;
assert.ok(source.includes('image: ${{ secrets.DOCKERHUB_USERNAME }}/toilet-admin:${{ github.sha }}'));
assert.ok(steps.find(s => s.uses?.startsWith('docker/build-push-action@')).with.tags.includes('${{ github.sha }}'));
assert.ok(!/docker (image|system|volume) prune|--remove-orphans|set -x/.test(source));
const secrets = {
  'secrets.SPRING_DB_URL': 'jdbc:mysql://fixture.invalid:3306/fixture?serverTimezone=Asia/Seoul',
  'secrets.SPRING_DB_USERNAME': 'fixture', 'secrets.SPRING_DB_PASSWORD': 'synthetic-only',
  'secrets.ADMIN_PORT': '8089', 'secrets.KAKAO_REST_API_KEY': 'fixture-rest',
  'secrets.KAKAO_JAVASCRIPT_KEY': 'fixture-js', 'secrets.DOCKERHUB_USERNAME': 'fixture',
  'github.sha': '1111111111111111111111111111111111111111'
};
let script = source.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
  assert.ok(Object.hasOwn(secrets, key), 'Unexpected secret reference');
  return secrets[key];
});
assert.equal((script.match(/~\/toilet-admin/g) || []).length, 2);
script = script.replaceAll('~/toilet-admin', '"$FIXTURE_DIR"');
const syntax = spawnSync(bash, ['-n'], {input: script, encoding: 'utf8'});
assert.equal(syntax.status, 0, syntax.stderr);
const harness = `
docker() {
  printf '%s\\n' "$*" >> "$FIXTURE_DIR/commands.log"
  case "$*" in
    'container inspect toilet-admin') [ "$TEST_MODE" != first ] ;;
    'container inspect --format {{.Image}} toilet-admin') printf '%s\\n' 'sha256:fixture-old' ;;
    'image inspect sha256:fixture-old') [ "$TEST_MODE" != imagefail ] ;;
    'image tag sha256:fixture-old '*) return 0 ;;
    'compose config --quiet') [ "$TEST_MODE" != configfail ] ;;
    'compose pull toilet-admin') [ "$TEST_MODE" != pullfail ] ;;
    'compose up -d --wait --wait-timeout 120 toilet-admin') [ "$TEST_MODE" != upfail ] ;;
    *) printf '%s\\n' 'Unexpected Docker operation' >&2; return 99 ;;
  esac
}
curl() {
  printf '%s\\n' 'health' >> "$FIXTURE_DIR/commands.log"
  case "$TEST_MODE" in
    healthfail) return 22 ;;
    healthdown) printf '%s' '{"status":"DOWN"}' ;;
    healthinvalid) printf '%s' 'not-json' ;;
    *) printf '%s' '{"status":"UP"}' ;;
  esac
}
python3() { "$PYTHON_FOR_TEST" "$@"; }
flock() { [ "$TEST_MODE" != locked ]; }
sleep() { :; }
`;
function bashPath(p) {return p.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase());}
for (const mode of ['success', 'first', 'locked', 'imagefail', 'configfail', 'pullfail', 'upfail', 'healthfail', 'healthdown', 'healthinvalid']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-deploy-fixture-'));
  if (mode !== 'first') {
    fs.writeFileSync(path.join(dir, '.env'), 'FIXTURE_OLD=true\n');
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'fixture-old-compose\n');
  }
  const result = spawnSync(bash, ['-s'], {input: harness + script, encoding: 'utf8', timeout: 30000,
    env: {...process.env, FIXTURE_DIR: bashPath(dir), PYTHON_FOR_TEST: python, TEST_MODE: mode}});
  assert.ok(!result.error, String(result.error));
  const successful = ['success', 'first'].includes(mode);
  assert.equal(result.status === 0, successful, mode + ': ' + result.stderr);
  const backups = fs.readdirSync(dir).filter(n => n.startsWith('rollback-preparation.'));
  const commandFile = path.join(dir, 'commands.log');
  const commands = fs.existsSync(commandFile) ? fs.readFileSync(commandFile, 'utf8') : '';
  if (mode === 'locked') {
    assert.equal(backups.length, 0);
    assert.equal(commands, '');
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'FIXTURE_OLD=true\n');
  } else {
    assert.equal(backups.length, 1);
    if (mode !== 'first') {
      assert.equal(fs.readFileSync(path.join(dir, backups[0], '.env'), 'utf8'), 'FIXTURE_OLD=true\n');
      assert.equal(fs.readFileSync(path.join(dir, backups[0], 'docker-compose.yml'), 'utf8'), 'fixture-old-compose\n');
    }
    if (['imagefail', 'configfail', 'pullfail'].includes(mode)) assert.ok(!commands.includes('compose up'));
    if (mode === 'imagefail') assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'FIXTURE_OLD=true\n');
    if (mode.startsWith('health')) assert.equal(commands.split('\n').filter(x => x === 'health').length, 30);
    if (mode === 'upfail') assert.ok(!commands.includes('health'));
    if (mode === 'success') assert.equal(fs.readFileSync(path.join(dir, backups[0], 'admin-image-id'), 'utf8'), 'sha256:fixture-old\n');
  }
  assert.ok(!commands.includes('prune'));
  assert.equal((commands.match(/compose up/g) || []).length <= 1, true);
  console.log('PASS ' + mode);
}
console.log('10 offline scenarios passed; no Docker/server/network/real secrets used. Synthetic temp fixtures retained.');
