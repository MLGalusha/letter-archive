/** Ordinary, serial browsing. No cache busting, parallel visitors, or production writes.
 * node e2e/scripts/image-scroll-benchmark.mjs --label baseline --runs 3
 * Optional: --base http://127.0.0.1:4175 --network 4g --viewports mobile,desktop
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, v, i, all) => v.startsWith('--') ? [...pairs, [v.slice(2), all[i+1]]] : pairs, []));
const base = args.base || 'https://voicesthatremain.com';
const label = args.label || 'baseline';
const runs = Number(args.runs || 3);
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Label must contain only lowercase letters, numbers and hyphens');
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw Error('Use 1–5 serial runs');
const network = args.network || 'native';
const stepMs=Number(args['step-ms']||800);
if (!['native','4g'].includes(network) || !Number.isFinite(stepMs) || stepMs < 250 || stepMs > 2000) throw Error('Invalid network or scroll interval');
const dir = `docs/image-loading/${label}`;
await mkdir(dir, {recursive:true});
const percentile = (v,p) => { const a=v.toSorted((a,b)=>a-b); return a.length ? Math.round(a[Math.max(0,Math.ceil(a.length*p)-1)]) : null; };
const browser = await chromium.launch({headless:true});
const results=[];
const frontendRelease=await fetch(base+'/version.json').then(r=>r.json()).catch(()=>null);
const bundleHash=args.assets?createHash('sha256').update(await readFile(resolve(args.assets,'index.html'))).digest('hex'):null;
try {
  for (const viewportName of (args.viewports || 'mobile,desktop').split(',')) {
    const viewport = viewportName === 'mobile' ? {width:390,height:844} : {width:1440,height:1000};
    for (const path of (args.paths || '/,/collections/009').split(',')) for (let run=1;run<=runs;run++) {
      const context=await browser.newContext({viewport,deviceScaleFactor:2});
      const page=await context.newPage();
      const cdp=await context.newCDPSession(page);
      await cdp.send('Network.enable');
      // Intercept only frontend files with CDP. Playwright page.route disables the
      // HTTP cache globally and would artificially duplicate progressive image loads.
      if (args.assets) {
        const root=resolve(args.assets);
        await cdp.send('Fetch.enable',{patterns:[{urlPattern:base+'/*',requestStage:'Request'}]});
        cdp.on('Fetch.requestPaused',async e=>{
          const url=new URL(e.request.url);
          const file=e.resourceType==='Document' ? resolve(root,'index.html') : resolve(root,'.'+url.pathname);
          if(!file.startsWith(root+sep))throw Error('Asset path outside build');
          try {
            const body=await readFile(file);
            const mime=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream';
            await cdp.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:mime}],body:body.toString('base64')});
          } catch {await cdp.send('Fetch.continueRequest',{requestId:e.requestId});}
        });
      }
      if (network === '4g') await cdp.send('Network.emulateNetworkConditions',{offline:false,downloadThroughput:4*1024*1024/8,uploadThroughput:3*1024*1024/8,latency:80});
      const requests=new Map(); const failures=[];
      cdp.on('Network.requestWillBeSent', e=> {if(e.type === 'Image') requests.set(e.requestId,{url:e.request.url,start:e.timestamp});});
      cdp.on('Network.responseReceived',e=>{const r=requests.get(e.requestId);if(r)Object.assign(r,{status:e.response.status,mime:e.response.mimeType,fromDiskCache:e.response.fromDiskCache||false,fromServiceWorker:e.response.fromServiceWorker||false,timing:e.response.timing,headers:Object.fromEntries(Object.entries(e.response.headers).filter(([name])=>['content-type','content-length','cache-control','etag','vary','timing-allow-origin'].includes(name.toLowerCase())))});});
      cdp.on('Network.loadingFinished',e=>{const r=requests.get(e.requestId);if(r)Object.assign(r,{durationMs:Math.round((e.timestamp-r.start)*1000),wireBytes:e.encodedDataLength});});
      cdp.on('Network.loadingFailed',e=>{const r=requests.get(e.requestId);if(r)Object.assign(r,{error:e.errorText,cancelled:e.canceled});});
      page.on('pageerror',e=>failures.push(e.message));
      await page.addInitScript(()=>{
        const state=window.__scrollImageBench={cards:[],samples:[],lcp:0,phase:'initial'};
        const records=new Map(); let last=0;
        new PerformanceObserver(list=>{state.lcp=list.getEntries().at(-1).startTime;}).observe({type:'largest-contentful-paint',buffered:true});
        setInterval(()=>{
          const now=performance.now(); let visible=0,unready=0;
          for(const el of document.querySelectorAll('.progressive-image, .preview-image')) {
            let record=records.get(el);
            const rect=el.getBoundingClientRect();
            const inView=rect.width>0 && rect.height>0 && rect.bottom>80 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth;
            const full=el.querySelector('.progressive-image__full, .preview-image__image');
            if(!full)continue;
            if(!record && inView) {record={index:state.cards.length,kind:el.className,entered:now,phase:state.phase,fullReady:null,usableReady:null,visibleBlockedMs:0,url:null};records.set(el,record);state.cards.push(record);}
            if(!record)continue;
            const imageReady=img=> img && img.complete && img.naturalWidth>0 && getComputedStyle(img).visibility!=='hidden' && Number(getComputedStyle(img).opacity)>=0.95;
            const isFull=imageReady(full) && !full.classList.contains('progressive-image__full--loading');
            const placeholder=el.querySelector('.progressive-image__thumb');
            const usable=isFull || (imageReady(placeholder) && placeholder.naturalWidth>=200);
            if(isFull && record.fullReady===null){record.fullReady=now;record.url=full.currentSrc;record.naturalWidth=full.naturalWidth;record.displayWidth=rect.width;}
            if(usable && record.usableReady===null)record.usableReady=now;
            if(inView){visible++;if(!isFull){unready++;record.visibleBlockedMs+=Math.min(now-last,100);}}
          }
          state.samples.push({ms:now,phase:state.phase,y:document.querySelector('#app-scroll')?.scrollTop||0,visible,unready});last=now;
        },50);
      });
      await page.goto(base+path,{waitUntil:'domcontentloaded'});
      await page.locator('.letter-card').first().waitFor({timeout:30000});
      await page.waitForTimeout(2000);
      // Move into the archive, then traverse at a fixed pace without waiting for images.
      await page.evaluate(()=>{const root=document.querySelector('#app-scroll');window.__scrollImageBench.phase='scroll';root.scrollTop+=document.querySelector('.letter-card').getBoundingClientRect().top-100;});
      for(let step=0;step<16;step++) {
        await page.waitForTimeout(stepMs);
        await page.evaluate(()=>{document.querySelector('#app-scroll').scrollBy({top:innerHeight*.65,behavior:'instant'});});
        if(step===10 && run===1) await page.screenshot({path:`${dir}/${viewportName}-${path==='/'?'home':'collection'}-scroll.jpg`,quality:75});
      }
      await page.waitForTimeout(5000);
      await page.evaluate(()=>{window.__scrollImageBench.phase='return';document.querySelector('#app-scroll').scrollTo({top:0,behavior:'instant'});});
      await page.waitForTimeout(1000);
      const state=await page.evaluate(()=>window.__scrollImageBench);
      const scrollCards=state.cards.filter(c=>c.phase==='scroll');
      const waits=scrollCards.filter(c=>c.fullReady!==null).map(c=>c.fullReady-c.entered);
      const usableWaits=scrollCards.filter(c=>c.usableReady!==null).map(c=>c.usableReady-c.entered);
      const images=[...requests.values()];
      const result={label,base,assets:args.assets||null,path,viewportName,viewport,deviceScaleFactor:2,network,run,summary:{cardsSeen:state.cards.length,scrollCards:scrollCards.length,unresolved:scrollCards.filter(c=>c.fullReady===null).length,p50FullWaitMs:percentile(waits,.5),p75FullWaitMs:percentile(waits,.75),p95FullWaitMs:percentile(waits,.95),maxFullWaitMs:percentile(waits,1),p75UsableWaitMs:percentile(usableWaits,.75),over3s:waits.filter(n=>n>=3000).length,imageRequests:images.length,wireBytes:images.reduce((n,r)=>n+(r.wireBytes||0),0),requestP75Ms:percentile(images.filter(r=>r.durationMs!==undefined).map(r=>r.durationMs),.75),lcpMs:Math.round(state.lcp),visibleBlockedMs:Math.round(scrollCards.reduce((n,c)=>n+c.visibleBlockedMs,0)),pageErrors:failures},...state,requests:images};
      results.push(result);
      const evidence={measuredAt:new Date().toISOString(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),frontendRelease,substitutedBundleSha256:bundleHash,method:{stepMs,steps:16,scrollViewportFraction:.65,settleMs:5000,pollMs:50,cache:'fresh browser context per run; origin cache uncontrolled',notes:'Full wait includes opacity transition. Only observed cards included; unresolved reported separately. No CPU throttle, not a physical phone.'},results};
      await writeFile(`${dir}/results.json.gz`,gzipSync(JSON.stringify(evidence)));
      await writeFile(`${dir}/summary.json`,JSON.stringify({...evidence,results:results.map(({cards,samples,requests,...rest})=>rest)},null,2)+'\n');
      console.log(JSON.stringify({path,viewportName,run,...result.summary}));
      await context.close();
    }
  }
} finally {await browser.close();}
