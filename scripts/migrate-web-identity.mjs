/** Offline Windows-only identity switch. Never run --apply without the parent's explicit ask_user_question consent. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, renameSync, appendFileSync, openSync, closeSync, writeFileSync, lstatSync } from 'node:fs';
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
const RELEASE_TARBALL_HASHES = Object.freeze({
  [SCOPED]: 'ff92b2bb2a3bc706c7b1ccfe088378006bd5850f0dcee96968aada81ee2da047',
  '@deepseek-ai/dsh-client-ui-layout': 'df984b6a078463477f25998fd9396ef7b53030dc457e1786e978ae4cc2a7a44e',
  '@deepseek-ai/dsh-client-ui-user-questions': 'f2c4c682bb704a616299b3fee5cce63d4adc0bd989cfa8cf29a0993332e9a286',
  '@deepseek-ai/dsh-client-ui-workspace': 'b5cc3c62ea9a55921ac5b9c6e24ddf793a6fcb179f76f54aee66432dbcbc1b3c',
});
const REAL_HOME = 'c:\\users\\chany\\.dsh';
const REAL_OLD_HASHES = {
  'package.json':'0648B0130B26E841FCA22EC0D02DD54BDBA1FDBDBD67A589A29A56CF0AF49362',
  'pnpm-lock.yaml':'772D87AA5281AF64AD3A99B59694D705939F46974977A1D820CF1C93FEC3B904',
  'cordis.patch.yml':'A9DD12E9B96672B86F703BC2E1ACC15D5250A84790718D97800BE944DCA51FCE',
  'pnpm-workspace.yaml':'2BD4CF6A081EAF66A4B6A90239920410697CC26C3DAD7FA79C59734166E7E6AC',
};
const timestamp = () => new Date().toISOString();
function nativeDir(p) { assert(existsSync(p) && lstatSync(p).isDirectory() && !lstatSync(p).isSymbolicLink(), 'missing or linked directory: '+p); }
function same(a,b,why) { assert(a === b, why); }
/** Fail-closed exact package, lock, patch, forks and disabled-Cindy gate; no data stores. */
export function verifyProfiles(home, expectedTarballHashes=RELEASE_TARBALL_HASHES) {
  const root = resolve(home, 'profiles'), old = join(root,'web'), stage = join(root,'web-stage-023');
  nativeDir(root); nativeDir(old); nativeDir(stage);
  if(resolve(home).toLowerCase()===REAL_HOME) for(const [name,expected] of Object.entries(REAL_OLD_HASHES)) same(digest(join(old,name)).toUpperCase(),expected,'real old baseline changed: '+name);
  const a=json(join(old,'package.json')), b=json(join(stage,'package.json'));
  assert(a.dependencies?.[OLD]?.includes('0.2.24') && !a.dependencies?.[SCOPED], 'old package identity mismatch');
  assert(b.dependencies?.[SCOPED]?.includes('0.2.3') && !b.dependencies?.[OLD], 'stage package identity mismatch');
  for (const key of new Set([...Object.keys(a.dependencies),...Object.keys(b.dependencies)])) {
    if (key !== OLD && key !== SCOPED) same(a.dependencies[key],b.dependencies[key], 'dependency differs: '+key);
  }
  same(JSON.stringify(a.dsh), JSON.stringify(b.dsh), 'bundles/profile differ');
  const patchA=readFileSync(join(old,'cordis.patch.yml'),'utf8'), patchB=readFileSync(join(stage,'cordis.patch.yml'),'utf8');
  if (resolve(home).toLowerCase().includes('sandbox')) assert(/- id: dsh-cindy-host\s+disabled: true/.test(patchB), 'sandbox Cindy not disabled');
  same(patchA.replace(/(name: )['"]?dsh-better-tasks['"]?/,"$1'@veewo/dsh-better-tasks'"),patchB,'composition patch differs outside identity');
  for(const name of ['cordis.yml','pnpm-workspace.yaml',PATCH]) same(digest(join(old,name)),digest(join(stage,name)),name+' differs');
  const workspace=readFileSync(join(stage,'pnpm-workspace.yaml'),'utf8');
  assert(workspace.includes('dsh-cost-meter@1.7.28: '+PATCH), 'cost patch mapping absent');
  const lock=readFileSync(join(stage,'pnpm-lock.yaml'),'utf8');
  assert(/dsh-cost-meter@1\.7\.28:\s+hash: [a-f0-9]{64}\s+path: patches\/dsh-cost-meter@1\.7\.28\.patch/.test(lock), 'lock cost patch hash missing');
  const patchHash=lock.match(/dsh-cost-meter@1\.7\.28:\s+hash: ([a-f0-9]{64})/)[1];
  assert(lock.includes('1.7.28(patch_hash='+patchHash+')'), 'locked cost-meter patch hash mismatch');
  assert(lock.includes("'"+SCOPED+"':") && !/^\s+['"]?dsh-better-tasks['"]?:/m.test(lock), 'lock identity mismatch');
  const stagePkg=json(join(stage,'node_modules',SCOPED,'package.json'));
  same(stagePkg.name,SCOPED,'installed scoped name differs'); same(stagePkg.version,'0.2.3','installed scoped version differs');
  assert(!existsSync(join(stage,'node_modules',OLD)), 'unscoped installation remains in stage');
  for(const name of FORKS) { assert(b.dependencies[name] && lock.includes("'"+name+"':"), 'fork missing: '+name); nativeDir(join(stage,'node_modules',name)); }
  for(const name of [SCOPED,...FORKS]) {
    const spec=b.dependencies[name];
    assert(spec.startsWith('file:') && spec.endsWith('.tgz'), 'not a pinned tarball: '+name);
    const tarball=spec.slice(5);
    assert(existsSync(tarball), 'tarball missing: '+tarball);
    same(digest(tarball),expectedTarballHashes[name],'release tarball SHA256 mismatch: '+name);
  }
  assert(existsSync(join(stage,'node_modules','.modules.yaml')), 'stage modules manifest missing');
  return { root,old,stage,patchHash,patchSha256:digest(join(stage,PATCH)),stagePackageSha256:digest(join(stage,'package.json')),stageLockSha256:digest(join(stage,'pnpm-lock.yaml')), profileConfig:a.dsh, scoped:stagePkg.version };
}
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
  const {profile,target:original,port,logFile,backup,home,cwd,failAt}=config;
  let movedOld=false,movedStage=false,started=false;
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
    note('stop.done',{tree}); if(failAt==='after-stop') throw new Error('injected after-stop failure');
    assert(!existsSync(backup),'backup path occupied');
    renameSync(profile.old,backup); movedOld=true; note('swap.old-backed-up',{backup});
    if(failAt==='after-first-rename') throw new Error('injected first-rename failure');
    renameSync(profile.stage,profile.old); movedStage=true; note('swap.stage-active');
    if(failAt==='after-second-rename') throw new Error('injected second-rename failure');
    note('install.begin',{command:'pnpm install --offline --frozen-lockfile',cwd:profile.old,CI:true});
    await ops.install(home,cwd); note('install.done');
    if(failAt==='after-install') throw new Error('injected install failure');
    const b=json(join(profile.old,'package.json'));
    same(JSON.stringify(b.dsh),JSON.stringify(profile.profileConfig),'profile bundles metadata reordered by install');
    assert(b.dependencies?.[SCOPED] && !b.dependencies?.[OLD], 'recheck scoped manifest failed');
    same(json(join(profile.old,'node_modules',SCOPED,'package.json')).version,'0.2.3','recheck installed identity failed');
    assert(!existsSync(join(profile.old,'node_modules',OLD)), 'unscoped identity reappeared');
    same(digest(join(profile.old,PATCH)),profile.patchSha256,'cost patch changed');
    const lock=readFileSync(join(profile.old,'pnpm-lock.yaml'),'utf8');
    assert(lock.includes('patch_hash='+profile.patchHash), 'cost patch lock hash changed');
    for(const fork of FORKS) nativeDir(join(profile.old,'node_modules',fork));
    assert(ops.listener(port)===null,'port occupied before start');
    note('start.begin',{args:original.args,cwd,home});
    await ops.start(original.args,cwd,home,port); started=true; note('start.verified');
  } catch(error) {
    note('failure',{message:error.message,started});
    if(error.unsafeToRestore) { note('MANUAL_RESTORE_REQUIRED',{reason:'candidate still alive; never rename under a live Host'}); throw error; }
    if(!started && (movedOld||movedStage)) {
      try {
        if(movedStage) { renameSync(profile.old,profile.stage); note('restore.stage'); }
        if(movedOld) { renameSync(backup,profile.old); note('restore.old'); }
      } catch(restoreError) { note('RESTORE_FAILED',{message:restoreError.message}); throw new AggregateError([error,restoreError],'migration failed; MANUAL RESTORE REQUIRED; Host stopped'); }
    }
    throw error; // Never auto-start old Host on failure.
  }
}
function realOps(o,globalBin,pnpmCli,baseline) { return {
  preStopGate:()=>{const current=verifyProfiles(o.dshHome);for(const key of ['patchSha256','stagePackageSha256','stageLockSha256'])same(current[key],baseline[key],'staged profile changed during grace: '+key);same(JSON.stringify(current.profileConfig),JSON.stringify(baseline.profileConfig),'old profile metadata changed during grace')},
  delay:sleep, target:()=>target(rows(),o.port),listener,alive:pid=>{try{process.kill(pid,0);return true}catch{return false}},
  async stop(tree) {
    for(const pid of [...tree].reverse()) { if(pid===process.pid) throw new Error('refusing self kill'); try{process.kill(pid)}catch(e){if(e.code!=='ESRCH')throw e} }
    for(let i=0;i<20;i++){if(listener(o.port)===null && tree.every(pid=>!this.alive(pid)))return;await sleep(250)}
    throw new Error('target tree still alive; Host remains stopped/unconfirmed');
  },
  install:async home=>spawnExit(process.execPath,[pnpmCli,'install','--offline','--frozen-lockfile'],{cwd:join(home,'profiles','web'),env:{...process.env,DSH_HOME:home,CI:'true'},stdio:'ignore',windowsHide:true}),
  async start(args,cwd,home,port) {
    const fd=openSync(join(o.logDir,'dsh-web.log'),'a'); let child;
    try {
      child=spawn(process.execPath,[globalBin,...args],{cwd,env:{...process.env,DSH_HOME:home},stdio:['ignore',fd,fd],detached:true,windowsHide:true});
      await new Promise((res,rej)=>{child.once('spawn',res);child.once('error',rej)});
      child.unref(); log(join(o.logDir,'migration.jsonl'),'start.pid',{pid:child.pid,listenTimeoutSeconds:90});
      for(let attempt=0;attempt<360;attempt++) {
        const owner=listener(port);
        if(owner===child.pid && this.alive(child.pid)) return;
        if(owner!==null && owner!==child.pid) throw new Error('port claimed by unrelated PID '+owner);
        if(!this.alive(child.pid)) throw new Error('candidate exited before listening');
        await sleep(250);
      }
      throw new Error('candidate did not listen within 90 seconds');
    } catch(error) {
      if(child?.pid && this.alive(child.pid)) {
        try { process.kill(child.pid); } catch(killError) { log(join(o.logDir,'migration.jsonl'),'candidate.kill-failed',{pid:child.pid,error:killError.message}); }
        for(let i=0;i<20 && this.alive(child.pid);i++) await sleep(250);
      }
      if(child?.pid && (this.alive(child.pid) || listener(port)===child.pid)) {
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
  const profile=verifyProfiles(home), t=target(rows(),o.port);
  const globalBin=join(process.env.APPDATA??'', 'npm','node_modules','@deepseek-ai','dsh','lib','bin.js');
  assert(existsSync(globalBin),'global dsh entry missing');
  const pnpmCli=join(process.env.APPDATA??'', 'npm','node_modules','pnpm','bin','pnpm.cjs');
  assert(existsSync(pnpmCli),'global pnpm CLI missing');
  const backup=join(profile.root,'web-backup-'+t.pid+'-'+String(t.creationDate).replace(/[^0-9A-Za-z]/g,''));
  assert(!existsSync(backup),'backup path already exists: '+backup);
  return {home,cwd,dir,profile,target:t,globalBin,pnpmCli,backup,port:o.port,grace:o.grace,failAt:o.injectFailure};
}
async function main() {
  const o=parseArgs(process.argv.slice(2)); const snapshot=inspect(o);
  const logFile=join(snapshot.dir,'migration.jsonl'); snapshot.logFile=logFile;
  if(!o.supervise) {
    console.log(JSON.stringify({mode:o.apply?'APPLY':'DRY RUN',port:o.port,targetPid:snapshot.target.pid,commandLine:snapshot.target.commandLine,relaunchArgs:snapshot.target.args,cwd:snapshot.cwd,cwdSource:'explicit operator assertion, not discoverable through CIM',cleanupPids:snapshot.target.tree,home:snapshot.home,stage:snapshot.profile.stage,profile:snapshot.profile.old,backup:snapshot.backup,patchHash:snapshot.profile.patchHash,graceSeconds:o.grace,install:'CI=true pnpm install --offline --frozen-lockfile (cwd: active profile)',logFile},null,2));
    if(!o.apply) return;
    mkdirSync(snapshot.dir,{recursive:true});
    const ticket=join(snapshot.dir,'ticket-'+process.pid+'-'+Date.now()+'.json'); writeFileSync(ticket,JSON.stringify(snapshot),{flag:'wx'});
    const args=[HERE,'--supervise','--ticket',ticket,'--port',String(o.port),'--grace',String(o.grace),'--dsh-home',snapshot.home,'--cwd',snapshot.cwd,'--log-dir',snapshot.dir,...(o.injectFailure?['--inject-failure',o.injectFailure]:[])];
    const command=[process.execPath,...args].map(x=>'"'+x.replaceAll('"','""')+'"').join(' ');
    // WMI-only detached supervisor. A failed WMI Create is fatal; no unsafe spawn fallback.
    const result=JSON.parse(ps(`Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${command.replaceAll("'","''")}' } | Select-Object ReturnValue,ProcessId | ConvertTo-Json -Compress`));
    assert(result.ReturnValue===0 && result.ProcessId>0,'WMI supervisor creation failed: '+JSON.stringify(result));
    log(logFile,'requested',{supervisorPid:result.ProcessId,ticket,grace:o.grace});
    console.log('WMI supervisor requested; outcome journal: '+logFile);
  } else {
    assert(o.ticket && existsSync(o.ticket),'missing supervisor ticket');
    const saved=json(o.ticket);
    same(saved.target.pid,snapshot.target.pid,'supervisor target changed before grace');
    same(saved.target.commandLine,snapshot.target.commandLine,'supervisor target command changed');
    same(saved.profile.patchSha256,snapshot.profile.patchSha256,'supervisor stage changed');
    await runMigration({...saved,logFile,failAt:o.injectFailure},realOps(o,snapshot.globalBin,snapshot.pnpmCli,saved.profile));
  }
}
if(process.argv[1] && resolve(process.argv[1])===HERE) main().catch(e=>{console.error(e.stack??e);process.exitCode=1});
