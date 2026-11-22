const path=require('path');const fs=require('fs');
const {chromium}=require('/home/user/.npm/_npx/f0a362733743bae2/node_modules/playwright-core');
(async()=>{
 const d=fs.mkdtempSync('/tmp/ytprobe-');
 const ctx=await chromium.launchPersistentContext(d,{headless:true,executablePath:process.env.HOME+'/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
  args:['--disable-extensions-except=/home/user/yt-adblock','--load-extension=/home/user/yt-adblock','--ignore-certificate-errors','--no-sandbox',
   '--host-resolver-rules=MAP www.youtube.com 127.0.0.1:8443, MAP *.youtube.com 127.0.0.1:8443']});
 const page=await ctx.newPage();
 await page.goto('https://www.youtube.com/watch?v=realvideo',{waitUntil:'load'});
 await page.waitForFunction(()=>window.__benchReady===true);
 await page.evaluate(()=>{document.querySelector('.ytp-skip-ad-button').remove();window.__benchStartAd(300);});
 for (const ms of [200,600,1200]) {
   await page.waitForTimeout(ms);
   const s=await page.evaluate(()=>({
     adShowing:document.getElementById('movie_player').classList.contains('ad-showing'),
     hasOverlay:!!document.querySelector('.ytp-ad-player-overlay'),
     scrollHeight:document.getElementById('video').scrollHeight,
     scrollWidth:document.getElementById('video').scrollWidth,
     duration:document.getElementById('video').duration,
     ct:document.getElementById('video').currentTime,
     seeks:window.__seeks,
   }));
   console.log(JSON.stringify(s));
 }
 await ctx.close();
})();
