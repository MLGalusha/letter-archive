/** Render the completed production comparison from recorded evidence; no network calls. */
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const root='docs/image-loading';
const read=async name=>JSON.parse(gunzipSync(await readFile(`${root}/${name}/results.json.gz`)));
const before=await read('production-before-4g');
const after=await read('production-after-4g');
const nativeBefore=await read('baseline-native');
const nativeAfter=await read('production-after-native');
const revisitBefore=await read('production-before-revisit');
const revisitAfter=await read('production-after-revisit');
const smallAfter=await read('production-after-small-collection');
const releaseCheck=await read('final-release-check');
const releaseRepeat=await read('final-release-repeat');
const lateRows=[['First release check',releaseCheck],['Repeat',releaseRepeat]].flatMap(([label,evidence])=>evidence.results.map(r=>({label,viewport:r.viewportName,p95:r.summary.p95FullWaitMs,unresolved:r.summary.unresolved,observed:r.summary.scrollCards})));
const lateWarning='Efficiency improved, but consistent fast loading is not yet achieved. A later check of the final release stalled while new backend instances started; a repeat recovered but remained slower than the paired comparison below. Cloud request logs confirm multi-second server response times. Cold starts and per-instance image caches are plausible contributors, not a proven complete diagnosis.';
const lateMd=lateRows.map(r=>`| ${r.label} | ${r.viewport} | ${r.p95} ms | ${r.unresolved} / ${r.observed} |`).join('\n');
const lateHtml=lateRows.map(r=>`<tr><td>${r.label}</td><td>${r.viewport}</td><td>${r.p95} ms</td><td>${r.unresolved} / ${r.observed}</td></tr>`).join('');
const mean=(runs,key)=>runs.reduce((sum,r)=>sum+r.summary[key],0)/runs.length;
const range=(runs,key)=>{const values=runs.map(r=>r.summary[key]);const low=Math.min(...values),high=Math.max(...values);return low===high?String(low):`${low}–${high}`;};
const number=n=>Math.round(n).toLocaleString('en-US');
const percent=(a,b)=>Math.round(100*(1-b/a));
const comparison={};
for(const viewport of ['desktop','mobile']) {
  const a=before.results.filter(r=>r.viewportName===viewport);
  const b=after.results.filter(r=>r.viewportName===viewport);
  if(a.length!==2||b.length!==2||a.some(r=>r.path!=='/')||b.some(r=>r.path!=='/'))throw Error('Expected two homepage runs per viewport');
  const previews=r=>new Set(r.requests.filter(q=>new URL(q.url).searchParams.get('w')==='480').map(q=>q.url));
  for(let i=0;i<a.length;i++){const old=previews(a[i]),current=previews(b[i]);if(old.size!==current.size||[...old].some(url=>!current.has(url)))throw Error('The 480-pixel preview workload changed; inspect comparison before reporting');}
  if(b.some(r=>r.summary.unresolved || r.summary.pageErrors.length))throw Error('Cannot accept unresolved images or page exceptions');
  comparison[viewport]={
    requests:[mean(a,'imageRequests'),mean(b,'imageRequests')],
    bytes:[mean(a,'wireBytes'),mean(b,'wireBytes')],
    p95:[range(a,'p95FullWaitMs'),range(b,'p95FullWaitMs')],
    requestP75:[range(a,'requestP75Ms'),range(b,'requestP75Ms')],
    unresolved:[a.reduce((n,r)=>n+r.summary.unresolved,0),b.reduce((n,r)=>n+r.summary.unresolved,0)],
    waits:[a[0],b[0]].map(r=>r.cards.filter(c=>c.phase==='scroll').map(c=>Math.round(c.fullReady-c.entered))),
  };
}
const revisit=[revisitBefore,revisitAfter].map(e=>e.results.find(r=>r.cacheState==='repeat visit'));
if(revisit.some(r=>!r))throw Error('Missing repeat-visit results');
const mdRows=Object.entries(comparison).map(([v,c])=>`| ${v} | ${number(c.requests[0])} → ${number(c.requests[1])} (${percent(...c.requests)}% fewer) | ${(c.bytes[0]/1e6).toFixed(2)} → ${(c.bytes[1]/1e6).toFixed(2)} MB (${percent(...c.bytes)}% less) | ${c.p95[0]} → ${c.p95[1]} ms |`).join('\n');
const nativeRows=[];
for(const viewport of ['desktop','mobile'])for(const path of ['/','/collections/009']) {
  const a=nativeBefore.results.filter(r=>r.viewportName===viewport&&r.path===path);
  const b=nativeAfter.results.filter(r=>r.viewportName===viewport&&r.path===path);
  if(a.length!==2||b.length!==2)throw Error('Missing native comparison');
  nativeRows.push(`| ${viewport} ${path} | ${number(mean(a,'imageRequests'))} → ${number(mean(b,'imageRequests'))} | ${range(a,'p95FullWaitMs')} → ${range(b,'p95FullWaitMs')} ms |`);
}
await writeFile(`${root}/report.md`,`# Production image loading — measured before and after

Two focused changes reduce the work needed to browse the archive: each grid card loads one native 480-pixel image, and small result sets no longer fetch an 800-pixel reader image for every item. Final preview resolution, server encoding and publication revalidation remain the same. No cloud configuration or capacity changes were made.

[Open the visual comparison](report.html) · [Experiment log](experiment-log.md) · [Run the benchmark](../../scripts/image-perf-program.md)

## Latest release check — remaining delay

${lateWarning}

Final deployed frontend: \`${releaseCheck.frontendRelease.releaseSha}\`. Same 4 Mbps / 80 ms fast-scroll method, one trial per viewport in each check.

| Check | Viewport | P95 readiness among completed images | Unresolved / observed scrolling images |
|---|---|---:|---:|
${lateMd}

The first check ended with unresolved images; its P95 excludes those unfinished images and understates the overall wait. Its incomplete transfer totals are not efficiency savings. The repeat completed all previews at 90 mobile / 96 desktop image requests and approximately 2.35 / 2.47 MB, confirming the reduced workload. Completed requests in the first check waited a median 6.0 seconds (mobile) / 4.4 seconds (desktop) for response headers. Server logs independently recorded multi-second image requests and instance startups in the same interval. Do not interpret the earlier 400 ms desktop result as a consistent production service level. See [release observations](final-release-observations.json).

## Paired production comparison

Before frontend: \`${before.frontendRelease.releaseSha}\`  
After frontend: \`${after.frontendRelease.releaseSha}\`

The same production homepage was scrolled 16 times at 400 ms intervals, 65% of a viewport each time, on a simulated 4 Mbps download / 80 ms latency connection. Two fresh-browser trials per viewport, DPR 2. These runs use actual deployed assets and images, without candidate substitution.

| Viewport | Image requests | Image data transferred | P95 readiness after first entering view, per-run range |
|---|---:|---:|---:|
${mdRows}

Request/data values are two-run means. P95 describes the slow end of the images observed in each run, not a real-user population percentile. Readiness includes the old loader's opacity fade. Images may finish after scrolling out of view. Zero means ready at the first 50 ms observation; it does not mean zero network latency. All scrolling images in these paired comparison trials resolved, with no page exceptions. The report generator also verifies that each paired run requested the exact same set of 480-pixel preview URLs; the saving comes from removing extra tiers, not omitting previews.

### Same scroll point, first desktop trial

Before:

![Production before](production-before-4g/desktop-home-scroll.jpg)

After:

![Production after](production-after-4g/desktop-home-scroll.jpg)

## Ordinary connection

The slower-paced native-connection comparison uses the original 800 ms scrolling interval. Many images already loaded before entering view in the baseline; the improvement is clearest in resource use and constrained fast scrolling.

| Scenario | Image requests | P95 readiness, per-run range |
|---|---:|---:|
${nativeRows.join('\n')}

## Repeat visits

On the ordinary connection, the second visit in the same browser context initiated ${revisit[0].summary.imageRequests} → ${revisit[1].summary.imageRequests} image requests and transferred ${number(revisit[0].summary.wireBytes)} → ${number(revisit[1].summary.wireBytes)} bytes. Browser caching already avoided most image data transfer before this work. Fewer preview requests reduce repeated checks; this is not a claim that repeat visits previously re-downloaded all the images. Returning within the same page is also covered by the browser regression.

## Architecture and scope

- Archive previews use one visible native image, one proximity observer and the existing 1200-pixel loading margin. Removed the 32/240/480 progression, detached image objects, second observer and final fade from these previews. Native loading continues to report image telemetry.
- Small result sets no longer preload every reader-sized scan. Collection 007's isolated experiment fell from 47 requests / roughly 1.5 MB to 30–31 requests / roughly 0.7 MB. A reversed control confirmed the resource difference. The deployed small-collection check confirmed 31 requests and ${(Math.min(...smallAfter.results.map(r=>r.summary.wireBytes))/1e6).toFixed(2)}–${(Math.max(...smallAfter.results.map(r=>r.summary.wireBytes))/1e6).toFixed(2)} MB across the two viewports, with no unresolved previews. Its first cold-transform delay is not presented as a guaranteed speedup.
- Larger reading/zoom views retain progressive loading. The bounded collection/reader preloader and hover prefetch remain. No cache TTL relaxation, image resolution reduction, new service, migration, dependency or framework was required.
- A browser regression checks one preview size, distant-image deferral and reuse when scrolling back. The benchmark records raw image bytes/timing, per-image readiness, unresolved images and screenshots. Candidate experiments and production verification are kept separate.

## What remains uncertain

This is one Chromium browser on one machine, with two trials per condition. Server cache state and other traffic are uncontrolled; native and throttled results are not interchangeable. The initial baseline included a 4.58-second request. This work substantially reduces the bursts sent to the API, but cannot guarantee instantaneous loading after a backend cold start or on every connection. Existing CPU observations showed occasional near-capacity samples; no causal or billing estimate is inferred from those mixed-traffic samples. Any cloud capacity, caching service or storage changes require a separate discussion.

The report delivery also adds an elapsed-time guard to native image telemetry, so a missing Resource Timing entry in a long session cannot become a false zero-duration reading. That instrumentation change does not alter image sources, sizes or scheduling; the benchmark measures DOM readiness and network timing independently. Final release proof is attached to the report delivery PR.

The handwriting checkout remains outside this work. Raw evidence is stored as \`results.json.gz\` next to readable \`summary.json\` files; [the directory guide](README.md) explains each experiment. Release and final CI proof are recorded in the delivery section of that guide.
`);
const payload=JSON.stringify(comparison).replaceAll('<','\\u003c');
await writeFile(`${root}/report.html`,`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Image loading: before and after</title>
<style>
:root{font-family:system-ui,sans-serif;color:#172c30;background:#f5f4ef}body{margin:0}main{max-width:1080px;margin:40px auto;padding:0 24px 60px}h1{font-size:clamp(28px,5vw,44px);letter-spacing:-.04em;margin-bottom:12px}p{max-width:80ch;line-height:1.55;color:#475b5d}a{color:#166b70}select{font:inherit;padding:10px;border:1px solid #bcc6c4;background:white;border-radius:6px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}.metric{background:white;padding:22px;border-radius:10px}.metric strong{display:block;font-size:30px;margin:8px 0}.muted{font-size:14px;color:#526566}.images{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}figcaption{font-weight:650;margin:8px 0}img{width:100%;height:auto;border-radius:8px}section{margin-top:30px}svg{width:100%;height:auto;background:white;border-radius:10px}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:12px;border-bottom:1px solid #e1e5e2}.table{overflow:auto}.legend span{display:inline-block;margin:6px 22px 6px 0}.before{color:#916552}.after{color:#087d75}@media(max-width:640px){main{padding:0 16px}.metrics{grid-template-columns:1fr}.images{grid-template-columns:1fr}}
</style></head><body><main>
<p>VOICES THAT REMAIN · PRODUCTION MEASUREMENTS</p><h1>Fewer image requests. Delays remain.</h1>
<p>Same 480-pixel archive previews. One image request per card. Measured on the deployed site before and after the fixes.</p>
<section aria-label="Latest release check"><h2>Latest check: loading is still inconsistent</h2><p>${lateWarning}</p><div class="table"><table><thead><tr><th>Check</th><th>Viewport</th><th>P95 completed</th><th>Unresolved / observed</th></tr></thead><tbody>${lateHtml}</tbody></table></div><p class="muted">Unresolved images are excluded from P95, so the first check understates the overall wait. The repeat completed every preview with the reduced request and byte totals. No cloud configuration changed.</p></section>
<h2>Earlier paired comparison</h2><label for="device">Comparison: </label><select id="device"><option value="desktop">Desktop · 1440 × 1000</option><option value="mobile">Mobile viewport · 390 × 844</option></select>
<div class="metrics" aria-live="polite"><div class="metric">Image requests<strong id="requests"></strong><span class="muted" id="request-change"></span></div><div class="metric">Image data<strong id="bytes"></strong><span class="muted" id="byte-change"></span></div><div class="metric">Slow-end readiness (P95)<strong id="wait" style="font-size:23px"></strong><span class="muted">Milliseconds; range across two trials</span></div></div>
<p class="muted">Fast scrolling: one 65%-viewport step every 400 ms. Simulated 4 Mbps download and 80 ms latency. Two fresh-browser trials at 2× pixel density; one machine, not physical-phone or real-user statistics.</p>
<section><h2>Did later batches get slower?</h2><div class="legend"><span class="before">■ Before</span><span class="after">■ After</span></div><svg id="chart" viewBox="0 0 1000 310" role="img" aria-label="Per-image readiness delay through the first scrolling trial"></svg><p class="muted">Images in the order first encountered, first trial. Time from entering view until full-quality display, including any fade. Some images finish after leaving the viewport. Zero means ready at the first observation (50 ms sampling).</p></section>
<section><h2>The same scroll point</h2><div class="images"><figure><figcaption>Before</figcaption><img id="before-image" alt="Production archive at the recorded scroll point before the change"></figure><figure><figcaption>After</figcaption><img id="after-image" alt="Production archive at the same scroll point after the change"></figure></div></section>
<section><h2>What changed</h2><p>Grid cards now load one correctly sized image instead of competing thumbnail, intermediate and final requests. Small result sets also stop downloading reader-sized scans for every item. Reading and zoom views keep their larger-image behavior.</p><p>No cloud capacity, billing settings, image encoding or publication cache policy changed. All images in the earlier paired comparison resolved; the later release checks above expose remaining delays. These results do not guarantee zero delay on every connection or after an API cold start.</p><p><a href="report.md">Detailed report</a> · <a href="experiment-log.md">Experiment history</a> · <a href="README.md">Evidence and release proof</a></p></section>
<script>
const data=${payload};const byId=id=>document.getElementById(id);const fmt=n=>Math.round(n).toLocaleString();
function draw(){const v=byId('device').value,c=data[v];byId('requests').textContent=c.requests.map(fmt).join(' → ');byId('request-change').textContent=Math.round((1-c.requests[1]/c.requests[0])*100)+'% fewer requests';byId('bytes').textContent=c.bytes.map(n=>(n/1e6).toFixed(2)).join(' → ')+' MB';byId('byte-change').textContent=Math.round((1-c.bytes[1]/c.bytes[0])*100)+'% less image data';byId('wait').textContent=c.p95.join(' → ');byId('before-image').src='production-before-4g/'+v+'-home-scroll.jpg';byId('after-image').src='production-after-4g/'+v+'-home-scroll.jpg';const plotWidth=Math.max(320,byId('chart').clientWidth),right=plotWidth-20;byId('chart').setAttribute('viewBox','0 0 '+plotWidth+' 310');const max=Math.max(3500,...c.waits.flat()),n=Math.max(...c.waits.map(a=>a.length)),width=(right-65)/n,parts=['<title>Readiness delay by image, before and after</title>'];for(let tick=0;tick<=max;tick+=1000){const y=260-tick/max*220;parts.push('<line x1="65" x2="'+right+'" y1="'+y+'" y2="'+y+'" stroke="#e0e6e3"/><text x="52" y="'+(y+4)+'" text-anchor="end" fill="#526566" font-size="14">'+(tick/1000)+' s</text>');}c.waits.forEach((list,series)=>list.forEach((wait,i)=>{const h=wait/max*220;parts.push('<rect x="'+(65+i*width+series*width/2)+'" y="'+(260-h)+'" width="'+Math.max(1,width/2-.5)+'" height="'+Math.max(1,h)+'" fill="'+(series?'#087d75':'#916552')+'"><title>'+(series?'After':'Before')+' · image '+(i+1)+' · '+wait+' ms</title></rect>');}));parts.push('<text x="65" y="289" font-size="14" fill="#526566">First images</text><text x="'+right+'" y="289" text-anchor="end" font-size="14" fill="#526566">Later images →</text>');byId('chart').innerHTML=parts.join('');}byId('device').addEventListener('change',draw);window.addEventListener('resize',draw);draw();
</script></main></body></html>`);
console.log('Wrote report.md and report.html from completed production evidence.');
