import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runMigration, parseArgs, verifyProfiles } from '../scripts/migrate-web-identity.mjs';
const forks=['@deepseek-ai/dsh-client-ui-layout','@deepseek-ai/dsh-client-ui-workspace','@deepseek-ai/dsh-client-ui-user-questions'];
const scoped='@veewo/dsh-better-tasks', oldName='dsh-better-tasks';
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'dsh-identity-contract-'));
  const home=join(root,'sandbox-home'), base=join(home,'profiles');
  const old=join(base,'web'),stage=join(base,'web-stage-023');
  mkdirSync(old,{recursive:true});mkdirSync(stage,{recursive:true});
  const tar=join(root,'candidate-0.2.3.tgz');writeFileSync(tar,'fake pinned tarball');
  const deps=Object.fromEntries(forks.map(name=>[name,'file:'+tar]));
  const oldDeps={...deps,[oldName]:'file:old-0.2.24.tgz'}, stageDeps={...deps,[scoped]:'file:'+tar};
  const patch='- id: dsh-cindy-host\n  disabled: true\n- id: better-tasks-sidebar\n  name: NAME\n';
  const hash='a'.repeat(64);
  for(const [dir,name,dependencies] of [[old,oldName,oldDeps],[stage,scoped,stageDeps]]) {
    writeFileSync(join(dir,'package.json'),JSON.stringify({dependencies,dsh:{profile:{bundles:['dsh-base','dsh-web-app'],patchReload:'live'}}}));
    writeFileSync(join(dir,'cordis.patch.yml'),patch.replace('NAME',name===scoped?"'"+name+"'":name));
    writeFileSync(join(dir,'cordis.yml'),'[]');
    writeFileSync(join(dir,'pnpm-workspace.yaml'),'patchedDependencies:\n  dsh-cost-meter@1.7.28: patches/dsh-cost-meter@1.7.28.patch');
    mkdirSync(join(dir,'patches'));writeFileSync(join(dir,'patches','dsh-cost-meter@1.7.28.patch'),'identical patch');
    writeFileSync(join(dir,'pnpm-lock.yaml'),"patchedDependencies:\n  dsh-cost-meter@1.7.28:\n    hash: "+hash+"\n    path: patches/dsh-cost-meter@1.7.28.patch\nimporters:\n  .:\n    dependencies:\n      '"+scoped+"':\n        version: 0.2.3\n      "+forks.map(f=>"'"+f+"':\n        version: 0.1").join('\n')+"\n    version: 1.7.28(patch_hash="+hash+")\n");
    mkdirSync(join(dir,'node_modules'));writeFileSync(join(dir,'node_modules','.modules.yaml'),'virtualStoreDir: fixture');
    for(const fork of forks) mkdirSync(join(dir,'node_modules',fork),{recursive:true});
    mkdirSync(join(dir,'node_modules',name),{recursive:true});writeFileSync(join(dir,'node_modules',name,'package.json'),JSON.stringify({name,version:name===scoped?'0.2.3':'0.2.24'}));
  }
  const logFile=join(root,'migration.jsonl'),target={pid:111,commandLine:'node bin.js web --port 3081',creationDate:'2026-01-01',args:['web','--port','3081'],tree:[111,112]};
  const fakeHash=createHash('sha256').update(readFileSync(tar)).digest('hex');
  const expectedTarballHashes=Object.fromEntries([scoped,...forks].map(name=>[name,fakeHash]));
  const profile=verifyProfiles(home,expectedTarballHashes), backup=join(base,'web-backup-test');
  const events=[];let listening=111,alive=new Set([111,112]);
  const ops={delay:async ms=>events.push(['delay',ms]),target:()=>target,listener:()=>listening,alive:pid=>alive.has(pid),stop:async tree=>{events.push(['stop',tree]);listening=null;alive.clear()},install:async()=>events.push(['install']),start:async()=>events.push(['start'])};
  const config={profile,target,port:3081,logFile,backup,home,cwd:root,grace:3};
  return {root,home,profile,config,ops,events,expectedTarballHashes,tar,setTarget:t=>ops.target=()=>t,failInstall:()=>ops.install=async()=>{throw Error('offline install failed')}};
}
const withFixture=async fn=>{const f=fixture();try{await fn(f)}finally{rmSync(f.root,{recursive:true,force:true})}};
test('existing sandbox profile passes read-only exact gate',()=>{
  const home=resolve('sandbox/identity-home');
  if(!existsSync(join(home,'profiles','web-stage-023'))) return;
  assert.equal(verifyProfiles(home).scoped,'0.2.3');
});
test('flags fail closed and keep default 3-second grace',()=>{
  assert.throws(()=>parseArgs(['--apply']),/explicit --dsh-home/);
  assert.equal(parseArgs(['--dsh-home','sandbox-home','--cwd','work','--log-dir','logs']).grace,3);
  assert.throws(()=>parseArgs(['--port','3080','--cwd','work','--dsh-home','real','--log-dir','logs','--inject-failure','after-stop']),/only in sandbox/);
});
test('read-only gate checks identity and staged patch',()=>withFixture(async f=>{
  assert.equal(f.profile.scoped,'0.2.3');
  writeFileSync(join(f.profile.stage,'patches','dsh-cost-meter@1.7.28.patch'),'mismatch');
  assert.throws(()=>verifyProfiles(f.home,f.expectedTarballHashes),/patch differs/);
}));
test('tampered release archive fails before process change',()=>withFixture(async f=>{
  writeFileSync(f.tar,'tampered');
  assert.throws(()=>verifyProfiles(f.home,f.expectedTarballHashes),/release tarball SHA256 mismatch/);
  assert.deepEqual(f.events,[]);
}));
test('grace PID/command identity mismatch prevents stop and mutations',()=>withFixture(async f=>{
  f.setTarget({...f.config.target,commandLine:'changed'});
  await assert.rejects(runMigration(f.config,f.ops),/target changed/);
  assert.deepEqual(f.events,[['delay',3000]]);
  assert.equal(existsSync(f.profile.old),true);assert.equal(existsSync(f.profile.stage),true);
}));
for(const failAt of ['after-stop','after-first-rename','after-second-rename','after-install']) {
  test('injected '+failAt+' restores old and never starts',()=>withFixture(async f=>{
    await assert.rejects(runMigration({...f.config,failAt},f.ops),/injected/);
    assert.equal(existsSync(f.profile.old),true);assert.equal(existsSync(f.profile.stage),true);
    assert.equal(JSON.parse(readFileSync(join(f.profile.old,'package.json'))).dependencies[oldName].includes('0.2.24'),true);
    assert.equal(f.events.some(e=>e[0]==='start'),false);
    assert.equal(f.events[1][0],'stop');assert.deepEqual(f.events[1][1],[111,112]);
    const stages=readFileSync(f.config.logFile,'utf8').trim().split('\n').map(x=>JSON.parse(x).stage);
    assert.equal(stages.includes('failure'),true);
    if(failAt==='after-second-rename') assert.deepEqual(stages.slice(-3),['failure','restore.stage','restore.old']);
  }));
}
test('offline install failure restores original and keeps Host stopped',()=>withFixture(async f=>{
  f.failInstall();await assert.rejects(runMigration(f.config,f.ops),/offline install failed/);
  assert.equal(existsSync(f.profile.old),true);assert.equal(f.events.some(e=>e[0]==='start'),false);
}));
test('pnpm metadata reorder is rejected and original restored',()=>withFixture(async f=>{
  f.ops.install=async()=>{
    const name=join(f.profile.old,'package.json'),pkg=JSON.parse(readFileSync(name,'utf8'));
    pkg.dsh.profile.bundles.reverse();writeFileSync(name,JSON.stringify(pkg));
  };
  await assert.rejects(runMigration(f.config,f.ops),/profile bundles metadata reordered/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.profile.old,'package.json'),'utf8')).dsh.profile.bundles,['dsh-base','dsh-web-app']);
  assert.equal(f.events.some(e=>e[0]==='start'),false);
}));
test('candidate start failure restores old and never retries old Host',()=>withFixture(async f=>{
  f.ops.start=async()=>{f.events.push(['start-failed']);throw new Error('candidate exited before listener')};
  await assert.rejects(runMigration(f.config,f.ops),/candidate exited before listener/);
  assert.equal(existsSync(f.profile.old),true);assert.equal(existsSync(f.profile.stage),true);
  assert.equal(f.events.filter(e=>e[0]==='start-failed').length,1);
  assert.equal(readFileSync(join(f.profile.old,'package.json'),'utf8').includes(oldName),true);
}));
test('success swaps profile only after stop and starts once',()=>withFixture(async f=>{
  await runMigration(f.config,f.ops);
  assert.deepEqual(f.events.map(e=>e[0]),['delay','stop','install','start']);
  assert.equal(existsSync(f.profile.stage),false);
  assert.equal(JSON.parse(readFileSync(join(f.profile.old,'package.json'))).dependencies[scoped]!==undefined,true);
  assert.equal(existsSync(f.config.backup),true);
}));
