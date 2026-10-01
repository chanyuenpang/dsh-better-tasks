/** One-shot Windows scoped .2.4 + mechanics 0.9.1 swap with bounded dev-only .25 rescue. Fresh consent required for real --apply. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, renameSync, appendFileSync, openSync, closeSync, writeFileSync, lstatSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (ok, why) => { if (!ok) throw new Error(why); };
const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const PATCH = 'patches/dsh-cost-meter@1.7.28.patch';
const FORKS = ['@deepseek-ai/dsh-client-ui-layout','@deepseek-ai/dsh-client-ui-workspace','@deepseek-ai/dsh-client-ui-user-questions'];
const SCOPED = '@veewo/dsh-better-tasks';
const OLD = 'dsh-better-tasks';
const STABLE = '@veewo/dsh-claw-kit';
const DEV = '@veewo/dsh-claw-kit-dev';
const RELEASE_TARBALL_HASHES = Object.freeze({
  '@deepseek-ai/dsh-client-ui-layout': 'df984b6a078463477f25998fd9396ef7b53030dc457e1786e978ae4cc2a7a44e',
  '@deepseek-ai/dsh-client-ui-user-questions': 'f2c4c682bb704a616299b3fee5cce63d4adc0bd989cfa8cf29a0993332e9a286',
  '@deepseek-ai/dsh-client-ui-workspace': 'b5cc3c62ea9a55921ac5b9c6e24ddf793a6fcb179f76f54aee66432dbcbc1b3c',
});
const REAL_HOME = 'c:\\users\\chany\\.dsh';
const REAL_STAGE_HASHES = {'package.json':'1947152D239D89C43419B37E3649F25E27065AF065C6BCB23D7B0F71EA41D8FE','pnpm-lock.yaml':'6F141CB0D763A4E9ADF8697B30F0023E07E29F27B027F7EB0479E2E0E7DD198D','cordis.patch.yml':'BB097C636AC0F7A5571F86269D4E9EE1DA9C6BCFBE04FFDC36A0A56E4DB741D0'};
const REAL_RESCUE_HASHES = {'package.json':'A8D27B207FA245E18A6B50E6EA86246C7BBD32817EA0EC2C5ABFD322EAC8E9FA','pnpm-lock.yaml':'7D81B8DEC089BDFCED30845E2DC7353B877D973C3C7261AF872EFC6A18DC2046','cordis.patch.yml':'A9DD12E9B96672B86F703BC2E1ACC15D5250A84790718D97800BE944DCA51FCE'};
const OLD_MAIN_SHA = '11453162bc7f2dde24a7de4d1157b61aab95036479dcc2c48626757a228fbf45';
const SCOPED_MAIN_SHA = '28465100cf5a2a7d783518abad5d0e6ff08848d1da5e87161e8dbb26f24cbc05';
const DEV_TARBALL_SHA = '24c9fa793e9c4777cf5f7154b5461213a6efdfdade6e8a7fc5d4e7a7506a7270';
const MECHANICS_INTEGRITY='sha512-2dkwfrzyQU539KknRiTN12/MPMWC7OE32jMiklRGO6a9lhkauhalUZb+u5bTl/6nyIF1i6n+WGygSDbst4WOVw==';
function verifyMechanicsGraph(profile,manifest) {
  same(manifest.dependencies?.['@veewo/mechanics'],'0.9.1','mechanics dependency spec mismatch: '+profile);
  const installed=json(join(profile,'node_modules','@veewo','mechanics','package.json'));
  same(installed.name,'@veewo/mechanics','installed mechanics identity mismatch');
  same(installed.version,'0.9.1','installed mechanics version mismatch');
  const lock=readFileSync(join(profile,'pnpm-lock.yaml'),'utf8');
  const importer=lock.split(/^packages:\s*$/m)[0];
  assert(/^\s+'@veewo\/mechanics':\s*\r?\n\s+specifier: 0\.9\.1\s*\r?\n\s+version: 0\.9\.1\s*$/m.test(importer),'mechanics lock importer mismatch: '+profile);
  const match=lock.match(/^\s+'@veewo\/mechanics@0\.9\.1':\s*\r?\n\s+resolution: \{integrity: (sha512-[^}]+)\}/m);
  assert(match,'mechanics registry resolution missing: '+profile);
  same(match[1],MECHANICS_INTEGRITY,'mechanics registry integrity mismatch: '+profile);
}

const REAL_OLD_HASHES = {
  'package.json':'A8D27B207FA245E18A6B50E6EA86246C7BBD32817EA0EC2C5ABFD322EAC8E9FA',
  'pnpm-lock.yaml':'7D81B8DEC089BDFCED30845E2DC7353B877D973C3C7261AF872EFC6A18DC2046',
  'cordis.patch.yml':'A9DD12E9B96672B86F703BC2E1ACC15D5250A84790718D97800BE944DCA51FCE',
  'cordis.yml':'C300DCF2EBC5F02062D6591268D29D3DB6FE45E0CB138F5467276FE2BA06076E',
  'pnpm-workspace.yaml':'2BD4CF6A081EAF66A4B6A90239920410697CC26C3DAD7FA79C59734166E7E6AC',
};
const timestamp = () => new Date().toISOString();
function nativeDir(p) { assert(existsSync(p) && lstatSync(p).isDirectory() && !lstatSync(p).isSymbolicLink(), 'missing or linked directory: '+p); }
function same(a,b,why) { assert(a === b, why); }
/** Verify old .25 dev-only graph against one pinned staged variant without touching stores. */
export function verifyProfiles(home,{oldPath,stagePath,variant='target'}={}) {
  assert(variant==='target'||variant==='rescue','unknown graph variant');
  const root=resolve(home,'profiles'),old=oldPath??join(root,'web'),stage=stagePath??join(root,variant==='rescue'?'web-rescue-025-mechanics':'web-stage-scoped-024-mechanics');
  nativeDir(root);nativeDir(old);nativeDir(stage);
  if(resolve(home).toLowerCase()===REAL_HOME) for(const [name,expected] of Object.entries(REAL_OLD_HASHES))
    same(digest(join(old,name)).toUpperCase(),expected,'real old baseline changed: '+name);
  if(resolve(home).toLowerCase()===REAL_HOME) for(const [name,expected] of Object.entries(variant==='rescue'?REAL_RESCUE_HASHES:REAL_STAGE_HASHES))
    same(digest(join(stage,name)).toUpperCase(),expected,'real staged graph changed: '+name);
  const a=json(join(old,'package.json')),b=json(join(stage,'package.json'));
  verifyMechanicsGraph(old,a);verifyMechanicsGraph(stage,b);
  assert(a.dependencies?.[OLD]?.endsWith('/0.2.25-unscoped/dsh-better-tasks-0.2.25.tgz') && !a.dependencies?.[SCOPED],'old unscoped .25 identity mismatch');
  same(digest(a.dependencies[OLD].slice(5)),OLD_MAIN_SHA,'old main archive SHA256 changed');
  assert(!a.dependencies?.[STABLE] && a.dependencies?.[DEV],'old Claw is not dev-only');
  const expectedBundles=a.dsh?.profile?.bundles;
  assert(Array.isArray(expectedBundles) && expectedBundles.filter(x=>x===DEV).length===1 && !expectedBundles.includes(STABLE),'old bundle is not dev-only');
  same(JSON.stringify(b.dsh),JSON.stringify(a.dsh),'bundle order/profile changed');
  if(variant==='target') {
    assert(!b.dependencies?.[OLD] && b.dependencies?.[SCOPED]?.endsWith('/0.2.4-scoped/veewo-dsh-better-tasks-0.2.4.tgz'),'scoped .2.4 identity mismatch');
  } else {
    assert(!b.dependencies?.[SCOPED] && b.dependencies?.[OLD]===a.dependencies[OLD],'rescue .25 identity mismatch');
  }
  assert(!b.dependencies?.[STABLE] && b.dependencies?.[DEV]===a.dependencies[DEV],'stable Claw present or dev Claw changed');
  for(const key of new Set([...Object.keys(a.dependencies),...Object.keys(b.dependencies)]))
    if(key!==OLD && key!==SCOPED) same(a.dependencies[key],b.dependencies[key],'dependency changed beyond main identity: '+key);
  for(const name of ['cordis.yml','pnpm-workspace.yaml',PATCH])
    same(digest(join(old,name)),digest(join(stage,name)),name+' changed');
  const oldPatch=readFileSync(join(old,'cordis.patch.yml'),'utf8'),newPatch=readFileSync(join(stage,'cordis.patch.yml'),'utf8');
  if(variant==='target') {
    assert(/^\s+name: dsh-better-tasks\s*$/m.test(oldPatch),'old sidebar identity missing');
    same(newPatch,oldPatch.replace(/^(\s+name:) dsh-better-tasks(\s*)$/m,"$1 '@veewo/dsh-better-tasks'$2"),'sidebar patch changed beyond identity');
    assert((newPatch.match(/name: '@veewo\/dsh-better-tasks'/g)??[]).length===1,'scoped sidebar not unique');
  } else same(newPatch,oldPatch,'rescue patch changed');
  assert(newPatch.includes('id: claw-kit'),'Claw patch missing');
  if(resolve(home).toLowerCase().includes('sandbox')) assert(/- id: dsh-cindy-host\s+disabled: true/.test(newPatch),'sandbox Cindy enabled');
  assert(readFileSync(join(stage,'pnpm-workspace.yaml'),'utf8').includes('dsh-cost-meter@1.7.28: '+PATCH),'cost patch mapping missing');
  const localProviderHashes={};
  function checkTree(relative) {
    const source=join(old,relative),dest=join(stage,relative);nativeDir(source);nativeDir(dest);
    for(const entry of readdirSync(source,{withFileTypes:true})) {
      const rel=join(relative,entry.name);
      if(entry.isDirectory()) checkTree(rel);
      else {assert(entry.isFile(),'local provider link unexpected: '+rel);const sha=digest(join(dest,entry.name));same(sha,digest(join(old,rel)),'local provider changed: '+rel);localProviderHashes[rel]=sha;}
    }
    same(readdirSync(source).length,readdirSync(dest).length,'local provider extra/missing files: '+relative);
  }
  if(existsSync(join(old,'plugins'))) checkTree('plugins');
  if(existsSync(join(old,'.dsh-module-fallback'))) {
    nativeDir(join(stage,'.dsh-module-fallback'));
    assert(readdirSync(join(stage,'.dsh-module-fallback')).length===0,'stage fallback must begin empty for regeneration');
  }
  for(const entry of readdirSync(old,{withFileTypes:true}).filter(x=>x.isFile()&&x.name.includes('.before-')))
    same(digest(join(old,entry.name)),digest(join(stage,entry.name)),'recovery file changed: '+entry.name);
  if(existsSync(join(old,'node_modules.pre-dsh-0.1.5-rc.2'))) {
    assert(!existsSync(join(stage,'node_modules.pre-dsh-0.1.5-rc.2')),'archived store must stay in backup');
    for(const name of ['package.json','cordis.patch.yml','cordis.yml','pnpm-workspace.yaml','pnpm-lock.yaml','node_modules/.modules.yaml'])
      assert(!readFileSync(join(stage,name),'utf8').includes('node_modules.pre-dsh-0.1.5-rc.2'),'archived store referenced: '+name);
  }
  const lock=readFileSync(join(stage,'pnpm-lock.yaml'),'utf8');
  const match=lock.match(/dsh-cost-meter@1\.7\.28:\s+hash: ([a-f0-9]{64})\s+path: patches\/dsh-cost-meter@1\.7\.28\.patch/);
  assert(match && lock.includes('1.7.28(patch_hash='+match[1]+')'),'cost patch lock hash mismatch');
  const importer=lock.split(/^packages:\s*$/m)[0];
  const wanted=variant==='target'?SCOPED:OLD,forbidden=variant==='target'?OLD:SCOPED;
  assert(!importer.includes("'"+forbidden+"':") && !new RegExp('^\\s+'+forbidden.replaceAll('/','\\/')+':','m').test(importer),'forbidden identity in lock importer');
  assert(importer.includes("'"+wanted+"':") || importer.includes('      '+wanted+':'),'wanted identity missing in importer');
  assert(importer.includes(b.dependencies[wanted]),'lock importer specifier differs from manifest');
  const installed=json(join(stage,'node_modules',wanted,'package.json'));
  same(installed.name,wanted,'installed package name mismatch');same(installed.version,variant==='target'?'0.2.4':'0.2.25','installed package version mismatch');
  assert(!existsSync(join(stage,'node_modules',forbidden)) && !existsSync(join(stage,'node_modules',STABLE)),'forbidden package installed');
  nativeDir(join(stage,'node_modules',DEV));
  for(const name of FORKS) {assert(b.dependencies[name] && importer.includes("'"+name+"':"),'fork absent from importer: '+name);nativeDir(join(stage,'node_modules',name));}
  const mainArchiveSha256=variant==='target'?SCOPED_MAIN_SHA:OLD_MAIN_SHA;
  for(const name of [wanted,DEV,...FORKS]) {
    const spec=b.dependencies[name];assert(spec.startsWith('file:') && spec.endsWith('.tgz'),'unpinned tarball: '+name);
    const archive=spec.slice(5);assert(existsSync(archive),'missing archive: '+archive);
    same(digest(archive),name===wanted?mainArchiveSha256:name===DEV?DEV_TARBALL_SHA:RELEASE_TARBALL_HASHES[name],'archive SHA256 mismatch: '+name);
  }
  assert(existsSync(join(stage,'node_modules','.modules.yaml')),'stage modules manifest missing');
  return {variant,root,old,stage,patchHash:match[1],patchSha256:digest(join(stage,PATCH)),stagePackageSha256:digest(join(stage,'package.json')),stageLockSha256:digest(join(stage,'pnpm-lock.yaml')),stageSidebarSha256:digest(join(stage,'cordis.patch.yml')),profileConfig:b.dsh,mainArchiveSha256,mechanicsIntegrity:MECHANICS_INTEGRITY,oldArchiveSha256:OLD_MAIN_SHA,devArchiveSha256:DEV_TARBALL_SHA,forkArchiveHashes:Object.fromEntries(FORKS.map(n=>[n,RELEASE_TARBALL_HASHES[n]])),localProviderHashes};
}
export function verifyRescue(home,options={}) {return verifyProfiles(home,{...options,variant:'rescue'});}
export function parseArgs(argv) {
  const o={port:3080,grace:3,apply:false,supervise:false};
  for(let i=0;i<argv.length;i++) {
    const flag=argv[i];
    if(flag==='--apply'||flag==='--supervise') o[flag.slice(2)]=true;
    else if(['--port','--grace','--dsh-home','--cwd','--log-dir','--ticket','--inject-failure'].includes(flag)) { assert(argv[i+1] && !argv[i+1].startsWith('--'),'missing value: '+flag); o[flag.slice(2).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=argv[++i]; }
    else throw new Error('unknown flag: '+flag);
  }
  o.port=Number(o.port); o.grace=Number(o.grace);
  assert(Number.isInteger(o.port) && o.port>=1 && o.port<=65535,'invalid port');
  assert(Number.isFinite(o.grace) && o.grace>=0 && o.grace<=60,'invalid grace');
  assert(o.dshHome && o.cwd && o.logDir, 'explicit --dsh-home, --cwd (asserted original Host cwd), --log-dir required');
  assert(!o.injectFailure || o.dshHome.toLowerCase().includes('sandbox'), 'failure injection only in sandbox home');
  return o;
}
function ps(script) { return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8'}).trim(); }
function rows() { const text=ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress'); const x=JSON.parse(text); return Array.isArray(x)?x:[x]; }
function listener(port) {
  const text=execFileSync('netstat.exe',['-ano','-p','TCP'],{encoding:'utf8'});
  const found=[...text.matchAll(/^\s*TCP\s+\S+:([0-9]+)\s+\S+\s+LISTENING\s+([0-9]+)\s*$/gmi)].filter(m=>Number(m[1])===port).map(m=>Number(m[2]));
  assert(new Set(found).size<=1, 'multiple listener owners'); return found[0]??null;
}
function target(rows,port) {
  const pid=listener(port); assert(pid,'no listener on port '+port);
  const row=rows.find(r=>r.ProcessId===pid); assert(row?.CommandLine && row.CreationDate,'target process inaccessible');
  const line=row.CommandLine; assert(/@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js/i.test(line), 'listener is not installed DSH');
  const tail=line.slice(line.search(/bin\.js/i)+6).replace(/^['"\s]+/,'').trim();
  const tokens=tail.match(/"[^"]*"|'[^']*'|\S+/g)?.map(s=>s.replace(/^["']|["']$/g,''))??[];
  assert(tokens[0]==='web','target is not dsh web');
  const seen=new Set();
  for(let i=1;i<tokens.length;i+=2) {
    const flag=tokens[i], value=tokens[i+1];
    assert((flag==='--profile' && value==='web') || (flag==='--port' && value===String(port)), 'unsupported target arguments');
    assert(!seen.has(flag),'duplicate target argument: '+flag); seen.add(flag);
  }
  const tree=new Set([pid]); for(let i=0;i<rows.length;i++) for(const r of rows) if(tree.has(r.ParentProcessId)) tree.add(r.ProcessId);
  return {pid,commandLine:line,creationDate:row.CreationDate,args:tokens,tree:[...tree]};
}
const log=(p,stage,detail={})=>appendFileSync(p,JSON.stringify({at:timestamp(),stage,...detail})+'\n');
function spawnExit(bin,args,options) { return new Promise((resolve,reject)=>{ const child=spawn(bin,args,options); child.on('error',reject); child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(bin+' exit '+code+' signal '+signal))); }); }
/** Isolated injectable runner used by contract tests; only target tree is ever killed. */
export async function runMigration(config,ops) {
  const {profile,rescueProfile,target:original,port,logFile,backup,home,cwd,failAt}=config;
  assert(rescueProfile?.variant==='rescue','prevalidated rescue graph required');
  let movedOld=false,movedStage=false,started=false,stopped=false;
  const note=(stage,detail)=>log(logFile,stage,detail);
  try {
    await ops.delay(config.grace*1000);
    if(ops.preStopGate) ops.preStopGate();
    const fresh=ops.target();
    assert(fresh.pid===original.pid && fresh.commandLine===original.commandLine && fresh.creationDate===original.creationDate,'target changed during grace');
    same(ops.listener(port),original.pid,'port owner changed during grace');
    // Snapshot children NOW, before killing parent; never sweep other DSH processes.
    const tree=fresh.tree;
    note('stop.begin',{tree}); await ops.stop(tree);
    assert(ops.listener(port)===null && tree.every(pid=>!ops.alive(pid)),'target port/tree still alive');
    note('stop.done',{tree}); stopped=true; if(failAt==='after-stop') throw new Error('injected after-stop failure');
    assert(!existsSync(backup),'backup path occupied');
    renameSync(profile.old,backup); movedOld=true; note('swap.old-backed-up',{backup});
    if(failAt==='after-first-rename') throw new Error('injected first-rename failure');
    renameSync(profile.stage,profile.old); movedStage=true; note('swap.stage-active');
    if(failAt==='after-second-rename') throw new Error('injected second-rename failure');
    note('install.begin',{command:'pnpm install --offline --frozen-lockfile',cwd:profile.old,CI:true});
    await ops.install(home,cwd); note('install.done');
    if(failAt==='after-install') throw new Error('injected install failure');
    const checked=verifyProfiles(home,{oldPath:backup,stagePath:profile.old});
    for(const key of ['patchHash','patchSha256','stagePackageSha256','stageLockSha256','stageSidebarSha256'])same(checked[key],profile[key],'active graph changed: '+key);
    same(JSON.stringify(checked.profileConfig),JSON.stringify(profile.profileConfig),'active bundle order changed');
    assert(ops.listener(port)===null,'port occupied before start');
    note('start.begin',{args:original.args,cwd,home});
    const tokenUrl=await ops.start(original.args,cwd,home,port); started=true; note('start.verified',{tokenUrl:tokenUrl??null,activatedIdentity:'@veewo/dsh-better-tasks@0.2.4 dev-only'});
  } catch(error) {
    note('candidate.failure',{message:error.message,started});
    if(!stopped || started) throw error; // Never rescue before old Host is fully stopped.
    if(error.unsafeToRestore) {
      note('MANUAL_RESTORE_REQUIRED',{reason:'scoped candidate subtree not confirmed gone',oldBackup:backup,targetStage:profile.stage,rescueStage:rescueProfile.stage});
      throw error;
    }
    try {
      assert(ops.listener(port)===null,'candidate port not free for rescue');
      if(movedStage) {
        assert(!existsSync(profile.stage),'target stage unexpectedly occupied');
        renameSync(profile.old,profile.stage); note('rescue.target-preserved',{stage:profile.stage});
      }
      if(!movedOld) {
        assert(!existsSync(backup),'old backup unexpectedly occupied');
        renameSync(profile.old,backup); note('rescue.old-backed-up',{backup});
      }
      assert(!existsSync(profile.old),'active profile unexpectedly occupied before rescue');
      renameSync(rescueProfile.stage,profile.old); note('rescue.active',{from:rescueProfile.stage,active:profile.old});
      note('rescue.install.begin',{command:'CI=true pnpm install --offline --frozen-lockfile',cwd:profile.old});
      await ops.install(home,cwd); note('rescue.install.done');
      const checked=verifyRescue(home,{oldPath:backup,stagePath:profile.old});
      for(const key of ['patchHash','patchSha256','stagePackageSha256','stageLockSha256','stageSidebarSha256'])
        same(checked[key],rescueProfile[key],'rescue graph changed: '+key);
      same(JSON.stringify(checked.profileConfig),JSON.stringify(rescueProfile.profileConfig),'rescue bundle order changed');
      assert(ops.listener(port)===null,'port occupied before rescue start');
      note('rescue.start.begin',{args:original.args,cwd,home,listenTimeoutSeconds:90});
      const tokenUrl=await ops.start(original.args,cwd,home,port); // Single conditional rescue attempt, no retries.
      note('rescue.start.verified',{tokenUrl:tokenUrl??null,rescuedIdentity:'dsh-better-tasks@0.2.25 dev-only',originalFailure:error.message,oldBackup:backup,targetStage:profile.stage});
      return {status:'rescued',tokenUrl};
    } catch(rescueError) {
      note('rescue.MANUAL_RECOVERY_REQUIRED',{message:rescueError.message,oldBackup:backup,targetStage:profile.stage,rescueStage:rescueProfile.stage,activeProfile:profile.old,activeExists:existsSync(profile.old),portOwner:ops.listener(port),hostStopped:ops.listener(port)===null});
      throw new AggregateError([error,rescueError],'candidate and bounded rescue failed; do not start old backup as an extra unapproved attempt');
    }
  }
}
function realOps(o,globalBin,pnpmCli,baseline) { return {
  preStopGate:()=>{
    for(const [current,expected] of [[verifyProfiles(o.dshHome),baseline.profile],[verifyRescue(o.dshHome),baseline.rescueProfile]]) {
      for(const key of ['patchSha256','stagePackageSha256','stageLockSha256'])same(current[key],expected[key],'staged graph changed during grace: '+key);
      same(JSON.stringify(current.profileConfig),JSON.stringify(expected.profileConfig),'profile metadata changed during grace');
    }
  },
  delay:sleep, target:()=>target(rows(),o.port),listener,alive:pid=>{try{process.kill(pid,0);return true}catch{return false}},
  async stop(tree) {
    for(const pid of [...tree].reverse()) { if(pid===process.pid) throw new Error('refusing self kill'); try{process.kill(pid)}catch(e){if(e.code!=='ESRCH')throw e} }
    for(let i=0;i<20;i++){if(listener(o.port)===null && tree.every(pid=>!this.alive(pid)))return;await sleep(250)}
    throw new Error('target tree still alive; Host remains stopped/unconfirmed');
  },
  install:async home=>spawnExit(process.execPath,[pnpmCli,'install','--offline','--frozen-lockfile'],{cwd:join(home,'profiles','web'),env:{...process.env,DSH_HOME:home,CI:'true'},stdio:'ignore',windowsHide:true}),
  async start(args,cwd,home,port) {
    const output=join(o.logDir,'dsh-web.log');
    const beforeBytes=existsSync(output)?statSync(output).size:0;
    const fd=openSync(output,'a'); let child; const candidateTree=new Set();
    try {
      child=spawn(process.execPath,[globalBin,...args],{cwd,env:{...process.env,DSH_HOME:home},stdio:['ignore',fd,fd],detached:true,windowsHide:true});
      await new Promise((res,rej)=>{child.once('spawn',res);child.once('error',rej)});
      child.unref(); log(join(o.logDir,'migration.jsonl'),'start.pid',{pid:child.pid,listenTimeoutSeconds:90});
      const deadline=Date.now()+90_000;
      while(Date.now()<deadline) {
        if(child?.pid) {
          const processes=rows(); candidateTree.add(child.pid);
          for(let n=0;n<processes.length;n++) for(const row of processes) if(candidateTree.has(row.ParentProcessId)) candidateTree.add(row.ProcessId);
        }
        const owner=listener(port);
        if(owner===child.pid && this.alive(child.pid)) {
          for(let tokenAttempt=0;tokenAttempt<20;tokenAttempt++) {
            const appended=readFileSync(output).subarray(beforeBytes).toString('utf8');
            const token=appended.match(new RegExp('dsh web: http://127\\.0\\.0\\.1:'+port+'/\\?token=[^\\s]+','g'))?.at(-1);
            if(token) return token.slice('dsh web: '.length);
            await sleep(250);
          }
          throw new Error('new listener lacks fresh token URL in output log');
        }
        if(owner!==null && owner!==child.pid) throw new Error('port claimed by unrelated PID '+owner);
        if(!this.alive(child.pid)) throw new Error('candidate exited before listening');
        await sleep(250);
      }
      throw new Error('candidate did not listen within 90 seconds');
    } catch(error) {
      if(child?.pid) {
        let processes;
        try { processes=rows(); } catch(probeError) {
          error.unsafeToRestore=true; log(join(o.logDir,'migration.jsonl'),'candidate.enumeration-failed',{message:probeError.message}); throw error;
        }
        candidateTree.add(child.pid);
        for(let n=0;n<processes.length;n++) for(const row of processes) if(candidateTree.has(row.ParentProcessId)) candidateTree.add(row.ProcessId);
        for(const pid of [...candidateTree].reverse()) if(this.alive(pid)) {
          try { process.kill(pid); } catch(killError) { log(join(o.logDir,'migration.jsonl'),'candidate.kill-failed',{pid,error:killError.message}); }
        }
        for(let i=0;i<20 && [...candidateTree].some(pid=>this.alive(pid));i++) await sleep(250);
      }
      if(child?.pid && ([...candidateTree].some(pid=>this.alive(pid)) || listener(port)===child.pid)) {
        error.unsafeToRestore=true;
        log(join(o.logDir,'migration.jsonl'),'candidate.STILL_ALIVE_MANUAL_RESTORE',{pid:child.pid});
      }
      throw error;
    } finally {closeSync(fd)}
  }
}; }
function inspect(o) {
  assert(process.platform==='win32','Windows only');
  const home=resolve(o.dshHome),cwd=resolve(o.cwd),dir=resolve(o.logDir);
  nativeDir(home);nativeDir(cwd);assert(dir!==home && !dir.startsWith(home+'\\profiles'), 'log directory must be outside profiles');
  const profile=verifyProfiles(home),rescueProfile=verifyRescue(home),t=target(rows(),o.port);
  same(JSON.stringify(rescueProfile.profileConfig),JSON.stringify(profile.profileConfig),'rescue bundle graph differs from target');
  same(rescueProfile.patchHash,profile.patchHash,'rescue cost patch hash differs');
  const globalBin=join(process.env.APPDATA??'', 'npm','node_modules','@deepseek-ai','dsh','lib','bin.js');
  assert(existsSync(globalBin),'global dsh entry missing');
  const pnpmCli=join(process.env.APPDATA??'', 'npm','node_modules','pnpm','bin','pnpm.cjs');
  assert(existsSync(pnpmCli),'global pnpm CLI missing');
  const backup=join(profile.root,'web-backup-'+t.pid+'-'+String(t.creationDate).replace(/[^0-9A-Za-z]/g,''));
  assert(!existsSync(backup),'backup path already exists: '+backup);
  return {home,cwd,dir,profile,rescueProfile,target:t,globalBin,pnpmCli,backup,port:o.port,grace:o.grace,failAt:o.injectFailure};
}
async function main() {
  const o=parseArgs(process.argv.slice(2));
  if(o.supervise) {
    assert(o.ticket && existsSync(o.ticket),'supervisor ticket missing or already claimed');
    const ticket=resolve(o.ticket),logDir=resolve(o.logDir);
    assert(dirname(ticket)===logDir && ticket.endsWith('.json'),'supervisor ticket outside journal directory');
    renameSync(ticket,ticket+'.claimed'); o.ticket=ticket+'.claimed'; // one-shot WMI route
  }
  const snapshot=inspect(o);
  const logFile=join(snapshot.dir,'migration.jsonl'); snapshot.logFile=logFile;
  if(!o.supervise) {
    console.log(JSON.stringify({mode:o.apply?'APPLY':'DRY RUN',port:o.port,targetPid:snapshot.target.pid,commandLine:snapshot.target.commandLine,relaunchArgs:snapshot.target.args,cwd:snapshot.cwd,cwdSource:'explicit operator assertion, not discoverable through CIM',cleanupPids:snapshot.target.tree,home:snapshot.home,stage:snapshot.profile.stage,rescue:snapshot.rescueProfile.stage,profile:snapshot.profile.old,backup:snapshot.backup,rescuePackageSha256:snapshot.rescueProfile.stagePackageSha256,rescueLockSha256:snapshot.rescueProfile.stageLockSha256,rescueArchiveSha256:snapshot.rescueProfile.mainArchiveSha256,conditionalRescueStartsMax:1,patchHash:snapshot.profile.patchHash,oldMetadataHashes:REAL_OLD_HASHES,oldArchiveSha256:snapshot.profile.oldArchiveSha256,stagePackageSha256:snapshot.profile.stagePackageSha256,stageLockSha256:snapshot.profile.stageLockSha256,mainArchiveSha256:snapshot.profile.mainArchiveSha256,mechanicsIntegrity:snapshot.profile.mechanicsIntegrity,devArchiveSha256:snapshot.profile.devArchiveSha256,forkArchiveHashes:snapshot.profile.forkArchiveHashes,localProviderHashes:snapshot.profile.localProviderHashes,bundles:snapshot.profile.profileConfig.profile.bundles,archivedStoreDisposition:'old profile retained whole in backup, staged and rescue fallbacks start empty for regeneration',graceSeconds:o.grace,install:'CI=true pnpm install --offline --frozen-lockfile (cwd: active profile)',logFile},null,2));
    if(!o.apply) return;
    mkdirSync(snapshot.dir,{recursive:true});
    const ticket=join(snapshot.dir,'ticket-'+process.pid+'-'+Date.now()+'.json'); writeFileSync(ticket,JSON.stringify(snapshot),{flag:'wx'});
    const args=[HERE,'--supervise','--ticket',ticket,'--port',String(o.port),'--grace',String(o.grace),'--dsh-home',snapshot.home,'--cwd',snapshot.cwd,'--log-dir',snapshot.dir,...(o.injectFailure?['--inject-failure',o.injectFailure]:[])];
    const command=[process.execPath,...args].map(x=>'"'+x.replaceAll('"','""')+'"').join(' ');
    // WMI-only detached supervisor. A failed WMI Create is fatal; no unsafe spawn fallback.
    const result=JSON.parse(ps(`Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${command.replaceAll("'","''")}' } | Select-Object ReturnValue,ProcessId | ConvertTo-Json -Compress`));
    assert(result.ReturnValue===0 && result.ProcessId>0,'WMI supervisor creation failed: '+JSON.stringify(result));
    log(logFile,'requested',{supervisorPid:result.ProcessId,ticket,grace:o.grace});
    console.log('WMI supervisor requested; outcome journal: '+logFile+'; new token URL (if started) in '+join(snapshot.dir,'dsh-web.log'));
  } else {
    assert(o.ticket && existsSync(o.ticket),'missing supervisor ticket');
    const saved=json(o.ticket);
    same(saved.target.pid,snapshot.target.pid,'supervisor target changed before grace');
    same(saved.target.commandLine,snapshot.target.commandLine,'supervisor target command changed');
    same(saved.profile.patchSha256,snapshot.profile.patchSha256,'supervisor target stage changed');
    same(saved.rescueProfile.stagePackageSha256,snapshot.rescueProfile.stagePackageSha256,'supervisor rescue stage changed');
    same(saved.rescueProfile.stageLockSha256,snapshot.rescueProfile.stageLockSha256,'supervisor rescue lock changed');
    await runMigration({...saved,logFile,failAt:o.injectFailure},realOps(o,snapshot.globalBin,snapshot.pnpmCli,saved));
  }
}
if(process.argv[1] && resolve(process.argv[1])===HERE) main().catch(e=>{console.error(e.stack??e);process.exitCode=1});
