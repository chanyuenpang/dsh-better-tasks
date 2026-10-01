import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {verifyProfiles,verifyRescue,runMigration,parseArgs} from '../scripts/migrate-web-scoped-024.mjs';
const STABLE='@veewo/dsh-claw-kit',DEV='@veewo/dsh-claw-kit-dev',MAIN='dsh-better-tasks',SCOPED='@veewo/dsh-better-tasks';
const FORKS=['@deepseek-ai/dsh-client-ui-layout','@deepseek-ai/dsh-client-ui-user-questions','@deepseek-ai/dsh-client-ui-workspace'];
const ROOT=resolve('.'), oldArchive='file:C:/Users/chany/.dsh/plugin-releases/dsh-better-tasks/0.2.25-unscoped/dsh-better-tasks-0.2.25.tgz';
const mainArchive='file:C:/Users/chany/.dsh/plugin-releases/dsh-better-tasks/0.2.4-scoped/veewo-dsh-better-tasks-0.2.4.tgz';
const devArchive='file:G:/Projects/claw-kit/dist/dev-dsh-plugin/veewo-dsh-claw-kit-dev-0.2.40.0.tgz';
const forks={
  [FORKS[0]]:'file:C:/Users/chany/.dsh/plugin-releases/dsh-better-tasks/0.2.0/deepseek-ai-dsh-client-ui-layout-0.1.5-rc.2.tgz',
  [FORKS[1]]:'file:C:/Users/chany/.dsh/plugin-releases/dsh-better-tasks/0.2.8/deepseek-ai-dsh-client-ui-user-questions-0.1.5-rc.2.tgz',
  [FORKS[2]]:'file:C:/Users/chany/.dsh/plugin-releases/dsh-better-tasks/0.2.1/deepseek-ai-dsh-client-ui-workspace-0.1.5-rc.2.tgz',
};
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'sandbox-scoped-024-')),home=join(root,'home'),dir=join(home,'profiles'),old=join(dir,'web'),stage=join(dir,'web-stage-scoped-024-dev'),rescue=join(dir,'web-rescue-025-dev-scoped-swap');
  for(const p of [old,stage,rescue]) mkdirSync(p,{recursive:true});
  const bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app',DEV];
  const common={...forks,[DEV]:devArchive,'dsh-cost-meter':'1.7.28'};
  const hash='a'.repeat(64),patch="- id: claw-kit\n  inject:\n    - webServer\n- id: dsh-cindy-host\n  disabled: true\n- id: better-tasks-sidebar\n  name: dsh-better-tasks\n";
  for(const [p,kind] of [[old,'old'],[stage,'target'],[rescue,'rescue']]){
    const isStage=kind!=='old';
    const dependencies={...common,[kind==='target'?SCOPED:MAIN]:kind==='target'?mainArchive:oldArchive};
    const b=bundles;
    writeFileSync(join(p,'package.json'),JSON.stringify({dsh:{profile:{bundles:b,patchReload:'live'}},dependencies}));
    writeFileSync(join(p,'cordis.patch.yml'),kind==='target'?patch.replace('name: dsh-better-tasks',"name: '@veewo/dsh-better-tasks'"):patch);writeFileSync(join(p,'cordis.yml'),'[]');
    writeFileSync(join(p,'pnpm-workspace.yaml'),'patchedDependencies:\n  dsh-cost-meter@1.7.28: patches/dsh-cost-meter@1.7.28.patch');
    mkdirSync(join(p,'patches'));writeFileSync(join(p,'patches','dsh-cost-meter@1.7.28.patch'),'patch');
    const keys=[...FORKS,DEV,kind==='target'?SCOPED:MAIN];
    writeFileSync(join(p,'pnpm-lock.yaml'),"patchedDependencies:\n  dsh-cost-meter@1.7.28:\n    hash: "+hash+"\n    path: patches/dsh-cost-meter@1.7.28.patch\nimporters:\n  .:\n    dependencies:\n"+keys.map(n=>"      '"+n+"':\n        specifier: "+dependencies[n]).join('\n')+"\n    version: 1.7.28(patch_hash="+hash+")\npackages:\n");
    mkdirSync(join(p,'node_modules'));writeFileSync(join(p,'node_modules','.modules.yaml'),'hoisted');
    if(isStage){for(const n of [...FORKS,DEV,kind==='target'?SCOPED:MAIN]){mkdirSync(join(p,'node_modules',n),{recursive:true});if(n===MAIN||n===SCOPED)writeFileSync(join(p,'node_modules',n,'package.json'),JSON.stringify({name:n,version:kind==='target'?'0.2.4':'0.2.25'}));}}
  }
  const profile=verifyProfiles(home),rescueProfile=verifyRescue(home),target={pid:111,creationDate:'t1',commandLine:'node bin.js web',args:['web'],tree:[111,112]},logFile=join(root,'journal.jsonl'),backup=join(dir,'web-backup-111');
  const events=[];let port=111,alive=new Set([111,112]);
  const ops={delay:async()=>events.push('delay'),target:()=>target,listener:()=>port,alive:pid=>alive.has(pid),stop:async tree=>{events.push('stop:'+tree.join(','));port=null;alive.clear()},install:async()=>events.push('install'),start:async()=>{events.push('start');return 'http://127.0.0.1:3080/?token=fixture'}};
  return {root,home,old,stage,rescue,profile,rescueProfile,events,ops,config:{profile,rescueProfile,target,port:3080,logFile,backup,home,cwd:root,grace:3}};
}
const withFixture=async fn=>{const f=fixture();try{await fn(f)}finally{rmSync(f.root,{recursive:true,force:true})}};
test('dry-run flags require explicit home/cwd and default grace 3',()=>{assert.throws(()=>parseArgs(['--apply']),/explicit --dsh-home/);assert.equal(parseArgs(['--dsh-home','sandbox','--cwd','work','--log-dir','logs']).grace,3)});
test('gate refuses stable provider or bundle reordering before stop',()=>withFixture(async f=>{
  const p=join(f.stage,'package.json'),b=JSON.parse(readFileSync(p));
  b.dsh.profile.bundles.reverse();writeFileSync(p,JSON.stringify(b));
  assert.throws(()=>verifyProfiles(f.home),/bundle order/);assert.deepEqual(f.events,[]);
}));
test('missing sibling stage refuses before stopping target',()=>withFixture(async f=>{
  rmSync(f.stage,{recursive:true,force:true});
  assert.throws(()=>verifyProfiles(f.home),/missing or linked directory/);assert.deepEqual(f.events,[]);
}));
test('copied fallback junctions are refused before stopping target',()=>withFixture(async f=>{
  mkdirSync(join(f.old,'.dsh-module-fallback','node_modules'),{recursive:true});
  mkdirSync(join(f.stage,'.dsh-module-fallback','node_modules'),{recursive:true});
  assert.throws(()=>verifyProfiles(f.home),/fallback must begin empty/);assert.deepEqual(f.events,[]);
}));
test('rescue bundle divergence refuses before stop',()=>withFixture(async f=>{
  const p=join(f.rescue,'package.json'),b=JSON.parse(readFileSync(p));
  b.dsh.profile.bundles.push(STABLE);writeFileSync(p,JSON.stringify(b));
  assert.throws(()=>verifyRescue(f.home),/bundle order/);assert.deepEqual(f.events,[]);
}));
test('rescue changed during grace refuses before target kill',()=>withFixture(async f=>{
  f.ops.delay=async()=>{f.events.push('delay');const p=join(f.rescue,'package.json'),b=JSON.parse(readFileSync(p));b.dsh.profile.bundles.push(STABLE);writeFileSync(p,JSON.stringify(b));};
  f.ops.preStopGate=()=>verifyRescue(f.home);
  await assert.rejects(runMigration(f.config,f.ops),/bundle order/);
  assert.deepEqual(f.events,['delay']);assert.equal(existsSync(f.old),true);
}));
test('uncleared candidate subtree forbids rescue rename or second start',()=>withFixture(async f=>{
  const error=Object.assign(new Error('candidate still alive'),{unsafeToRestore:true});
  f.ops.start=async()=>{throw error};
  await assert.rejects(runMigration(f.config,f.ops),/candidate still alive/);
  assert.equal(existsSync(f.config.backup),true);assert.equal(existsSync(f.rescue),true);assert.equal(existsSync(f.stage),false);
}));
for(const failAt of ['after-stop','after-first-rename','after-second-rename','after-install']) {
  test('injected '+failAt+' preserves scoped stage and starts rescue once',()=>withFixture(async f=>{
    const result=await runMigration({...f.config,failAt},f.ops);
    assert.equal(result.status,'rescued');assert.equal(existsSync(f.config.backup),true);assert.equal(existsSync(f.stage),true);
    assert.equal(existsSync(f.rescue),false);
    assert.equal(f.events.filter(x=>x==='start').length,1);
    const active=JSON.parse(readFileSync(join(f.old,'package.json')));
    assert.equal(active.dependencies[MAIN],oldArchive);assert.equal(active.dependencies[SCOPED],undefined);
    const staged=JSON.parse(readFileSync(join(f.stage,'package.json')));
    assert.equal(staged.dependencies[SCOPED],mainArchive);
  }));
}
test('sidebar mutation beyond identity refuses before process change',()=>withFixture(async f=>{
  const p=join(f.stage,'cordis.patch.yml');writeFileSync(p,readFileSync(p,'utf8')+'- id: unexpected\n');
  assert.throws(()=>verifyProfiles(f.home),/sidebar patch changed beyond identity/);
  assert.deepEqual(f.events,[]);
}));
test('metadata reorder triggers known-startable unscoped .25 dev-only rescue',()=>withFixture(async f=>{
  let installs=0;
  f.ops.install=async()=>{installs++;f.events.push('install');if(installs===1){const p=join(f.old,'package.json'),b=JSON.parse(readFileSync(p));b.dsh.profile.bundles.reverse();writeFileSync(p,JSON.stringify(b));}};
  const result=await runMigration(f.config,f.ops);
  assert.equal(result.status,'rescued');assert.equal(installs,2);assert.deepEqual(f.events,['delay','stop:111,112','install','install','start']);
  assert.equal(JSON.parse(readFileSync(join(f.old,'package.json'))).dependencies[MAIN],oldArchive);
  assert.equal(existsSync(f.config.backup),true);assert.equal(existsSync(f.stage),true);assert.equal(existsSync(f.rescue),false);
}));
test('candidate offline install failure repairs rescue then starts it once',()=>withFixture(async f=>{
  let installs=0;f.ops.install=async()=>{installs++;f.events.push('install');if(installs===1)throw Error('candidate offline install failed')};
  const result=await runMigration(f.config,f.ops);
  assert.equal(result.status,'rescued');assert.equal(installs,2);assert.equal(f.events.filter(e=>e==='start').length,1);
  assert.equal(existsSync(f.config.backup),true);assert.equal(existsSync(f.stage),true);
}));
test('candidate startup failure allows one rescue startup with original args',()=>withFixture(async f=>{
  let starts=0;f.ops.start=async(args,cwd,home,port)=>{starts++;f.events.push('start:'+starts);assert.deepEqual(args,['web']);assert.equal(cwd,f.root);assert.equal(home,f.home);assert.equal(port,3080);if(starts===1)throw Error('candidate failed to listen');return 'http://127.0.0.1:3080/?token=rescue'};
  const result=await runMigration(f.config,f.ops);
  assert.equal(result.status,'rescued');assert.equal(starts,2);assert.equal(result.tokenUrl,'http://127.0.0.1:3080/?token=rescue');
  assert.equal(JSON.parse(readFileSync(join(f.old,'package.json'))).dependencies[MAIN],oldArchive);
  const backedUp=JSON.parse(readFileSync(join(f.config.backup,'package.json')));
  assert.equal(backedUp.dependencies[MAIN],oldArchive);assert.equal(backedUp.dependencies[STABLE],undefined);
}));
test('rescue install failure keeps rescue active and Host stopped',()=>withFixture(async f=>{
  f.ops.install=async()=>{throw Error('offline install failed')};
  await assert.rejects(runMigration(f.config,f.ops),e=>e instanceof AggregateError && e.errors.length===2);
  assert.equal(existsSync(f.config.backup),true);assert.equal(existsSync(f.stage),true);assert.equal(existsSync(f.rescue),false);
  assert.equal(f.events.some(e=>e==='start'),false);
  const journal=readFileSync(f.config.logFile,'utf8');assert.match(journal,/rescue.MANUAL_RECOVERY_REQUIRED/);
}));
test('rescue start failure never launches a third Host',()=>withFixture(async f=>{
  let starts=0;f.ops.start=async()=>{starts++;throw Error('failed to listen')};
  await assert.rejects(runMigration(f.config,f.ops),e=>e instanceof AggregateError);
  assert.equal(starts,2);assert.equal(existsSync(f.config.backup),true);assert.equal(existsSync(f.stage),true);
}));

test('successful migration activates only scoped .2.4 dev-only package',()=>withFixture(async f=>{
  await runMigration(f.config,f.ops);
  assert.deepEqual(f.events,['delay','stop:111,112','install','start']);
  assert.equal(existsSync(f.config.backup),true);assert.equal(existsSync(f.stage),false);
  const b=JSON.parse(readFileSync(join(f.old,'package.json')));
  assert.equal(b.dependencies[MAIN],undefined);assert.equal(b.dependencies[SCOPED],mainArchive);
  assert.equal(b.dependencies[STABLE],undefined);assert.equal(b.dsh.profile.bundles.filter(x=>x===DEV).length,1);
  assert.match(readFileSync(f.config.logFile,'utf8'),/http:\/\/127\.0\.0\.1:3080\/\?token=fixture/);
}));
