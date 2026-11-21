// Hosted-CI-only integration against the immutable first-party GoreeCloud VPN Go service.
// It opens one disposable 127.0.0.1 process, uses a synthetic token and owner-private
// state. No WireGuard interface, gateway, production service, DNS or host route is changed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSyntheticHarness, CONTRACT_VERSION } from '../synthetic/harness.mjs';
import { createVPNHealthFixtureAdapter } from './vpn-healthz.mjs';

const EXPECTED_WIRE = '{"status":"ok"}\n';
const OBSERVED_AT = '2026-11-21T12:00:00.000Z';
const CAPABILITY = 'vpn.health';

async function choosePort() {
  const s = createServer();
  await new Promise((yes, no) => { s.once('error', no); s.listen(0, '127.0.0.1', yes); });
  const port = s.address().port;
  await new Promise((yes, no) => s.close(err => err ? no(err) : yes()));
  assert.ok(port >= 1024 && port <= 65535);
  return port;
}
function startVPN(binary, root, port) {
  const child = spawn(binary, [
    '--listen', '127.0.0.1:' + port,
    '--state-dir', join(root, 'state'),
    '--token-file', join(root, 'admin-token'),
  ], {cwd: root, stdio: 'ignore'});
  child.on('error', () => {});
  return child;
}
async function stopVPN(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise(ok => child.once('exit', () => ok(true)));
  child.kill('SIGTERM');
  if (!(await Promise.race([done, sleep(1500).then(() => false)])) &&
      child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([new Promise(ok => child.once('exit', ok)), sleep(850)]);
  }
}
function loopback(port, path = '/healthz', token = '') {
  assert.ok(['/healthz', '/v1/peers', '/v1/info'].includes(path));
  return new Promise((yes, no) => {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = httpRequest({
      host: '127.0.0.1', family: 4, port, path, method: 'GET',
      agent: false, headers,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > (path === '/healthz' ? 256 : 8192)) {
          req.destroy(new Error('bounded response exceeded limit'));
        }
      });
      response.once('error', () => no(new Error('private source unavailable')));
      response.once('end', () => yes({
        status: response.statusCode, contentType: response.headers['content-type'], body,
      }));
    });
    req.setTimeout(800, () => req.destroy(new Error('private source deadline')));
    req.once('error', () => no(new Error('private source unavailable')));
    req.end();
  });
}
async function main() {
  const source = resolve(process.argv[2] || '');
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_REPOSITORY !== 'GoreeCloud/mesh' ||
      process.env.GC_MESH_VPN_ISOLATED_TEST !== '1' ||
      source !== resolve('vpn-source')) {
    throw new Error('only a reviewed first-party Go VPN source in Mesh CI may run');
  }
  const binary = join(source, 'vpnd-test');
  assert.ok((await stat(binary)).isFile());
  const root = await mkdtemp(join(tmpdir(), 'mesh-vpn-go-'));
  await chmod(root, 0o700);
  const token = randomBytes(48).toString('hex');
  await writeFile(join(root, 'admin-token'), token + '\n', {flag:'wx', mode:0o600});
  const port = await choosePort();
  let transportCalls = 0;
  let meshPermit = false;
  let ownerPermit = false;
  const adapter = createVPNHealthFixtureAdapter({
    permit: () => ownerPermit,
    clock: () => OBSERVED_AT,
    transport: async ({method,path,signal}) => {
      if (method !== 'GET' || path !== '/healthz' || signal?.aborted) {
        throw new Error('read-only health contract violated');
      }
      transportCalls++;
      return loopback(port);
    },
  });
  const harness = createSyntheticHarness({
    manifest: {
      schema_version: CONTRACT_VERSION, environment: 'synthetic-local-only',
      capabilities: [{
        id: CAPABILITY, owner: 'vpn', version: '0.0.1-fixture',
        operation: 'status.read', sensitivity: 'synthetic', evidence_status: 'prototype',
      }],
    },
    adapters: {[CAPABILITY]:adapter},
    meshPermit:()=>meshPermit,timeoutMs:900,
  });
  const read = () => harness.read({
    actor: 'synthetic-ci', capabilityId: CAPABILITY, operation:'status.read',
  });
  let child;
  try {
    assert.equal((await read()).error.code, 'denied');
    assert.equal(transportCalls, 0);
    meshPermit = true;
    assert.equal((await read()).error.code, 'denied');
    assert.equal(transportCalls, 0);
    ownerPermit = true;
    child = startVPN(binary, root, port);
    let online = false;
    for(let i=0;i<50;i++){
      if (child.exitCode!==null || child.signalCode!==null) break;
      const res = await read();
      if (res.ok) {
        assert.deepEqual(res.data,{state:'ok',observed_at:OBSERVED_AT});
        online = true;break;
      }
      await sleep(100);
    }
    assert.equal(online, true, 'pinned Go control-plane did not become healthy');
    assert.equal((await loopback(port)).body, EXPECTED_WIRE);
    assert.equal((await loopback(port, '/v1/peers')).status,401);
    assert.equal((await loopback(port, '/v1/info', 'wrong-token')).status,401);
    const info = await loopback(port, '/v1/info', token);
    assert.equal(info.status,200);
    assert.equal(JSON.parse(info.body).tunnel_operational,false);
    assert.equal((await loopback(port, '/v1/peers', token)).status,200);
    process.stdout.write('checkpoint=go_control_plane_liveness_and_bearer_denial\n');
    ownerPermit = false;
    const previous = transportCalls;
    assert.equal((await read()).error.code,'denied');
    assert.equal(transportCalls, previous);
    ownerPermit = true;
    await stopVPN(child);
    assert.equal((await read()).error.code,'unavailable');
    child = startVPN(binary,root,port);
    let restored=false;
    for(let i=0;i<50;i++){
      if(child.exitCode!==null || child.signalCode!==null)break;
      if((await read()).ok===true){restored=true;break;}
      await sleep(100);
    }
    assert.equal(restored,true,'Go management process did not restart with private state');
    assert.equal((await loopback(port,'/v1/peers')).status,401);
    process.stdout.write('PASS: pinned first-party Go VPN / Mesh local read-only health contract\n');
  } finally {
    await stopVPN(child);
    await rm(root,{recursive:true,force:true});
  }
}
await main();
