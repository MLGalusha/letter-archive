async (page) => {
  page.__cdp = await page.context().newCDPSession(page);
  await page.__cdp.send('Network.enable');
  page.__cdp.on('Network.requestWillBeSent', e => { if(page.__network) page.__network.set(e.requestId,{url:e.request.url,started:e.timestamp}); });
  page.__cdp.on('Network.loadingFinished', e => { const row=page.__network?.get(e.requestId); if(row)Object.assign(row,{finished:e.timestamp,bytes:e.encodedDataLength}); });
  await page.addInitScript(() => {
    window.__visibleImages = new Map();
    let previous=performance.now();
    window.__blankMax=0;
    setInterval(() => {
      const now=performance.now(), elapsed=now-previous; previous=now;
      let blank=0;
      for(const img of document.querySelectorAll('.preview-image__image')) {
        const box=img.getBoundingClientRect();
        if(box.width===0||box.height===0||box.bottom<=0||box.top>=innerHeight||box.right<=0||box.left>=innerWidth)continue;
        let row=window.__visibleImages.get(img);
        if(!row){row={alt:img.alt,visibleWaitMs:0};window.__visibleImages.set(img,row)}
        if(!img.complete||!img.naturalWidth){row.visibleWaitMs+=elapsed;blank++}
      }
      window.__blankMax=Math.max(window.__blankMax,blank);
    },50);
  });
  page.__capture = async ({origin,route='/',width=1440,height=900,dpr=1,step=350,interval=700,steps=20}) => {
    await page.setViewportSize({width,height});
    await page.__cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:width<600});
    await page.__cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await page.__cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:500000,uploadThroughput:500000});
    page.__network=new Map();
    await page.goto(origin+route);
    await page.waitForTimeout(6000);
    const summarize=async()=>({
      images:[...page.__network.values()].filter(r=>r.url.includes('/images/')),
      search:[...page.__network.values()].filter(r=>r.url.includes('/letters/search')),
      dom:await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},cards:document.querySelectorAll('.archive-section .letter-card:not(.letter-card-skeleton)').length,visible:[...window.__visibleImages.values()],blankMax:window.__blankMax,status:document.querySelector('.search-status')?.textContent,complete:document.querySelector('.archive-complete-message')?.textContent}))
    });
    const initial=await summarize();
    await page.evaluate(()=>{window.__visibleImages.clear();window.__blankMax=0});
    for(let i=0;i<steps;i++){
      await page.evaluate(amount=>{const app=document.querySelector('#app-scroll');const root=app&&app.scrollHeight>app.clientHeight?app:document.scrollingElement;root.scrollBy({top:amount,behavior:'instant'})},step);
      await page.waitForTimeout(interval);
    }
    await page.waitForTimeout(1500);
    return {conditions:{origin,route,width,height,dpr,step,interval,steps,latency:80,downloadBytesPerSec:500000,cache:'disabled',cpu:'unthrottled'},initial,scrolled:await summarize()};
  };
  return 'capture ready';
}
