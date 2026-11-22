const fs=require('fs');
const {chromium}=require('/home/user/.npm/_npx/f0a362733743bae2/node_modules/playwright-core');
(async()=>{
 const d=fs.mkdtempSync('/tmp/ytprobe3-');
 const ctx=await chromium.launchPersistentContext(d,{headless:true,executablePath:process.env.HOME+'/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
  args:['--disable-extensions-except=/home/user/yt-adblock','--load-extension=/home/user/yt-adblock','--ignore-certificate-errors','--no-sandbox',
   '--host-resolver-rules=MAP www.youtube.com 127.0.0.1:8443, MAP *.youtube.com 127.0.0.1:8443']});
 const page=await ctx.newPage();
 await page.goto('https://www.youtube.com/watch?v=realvideo',{waitUntil:'load'});
 await page.waitForFunction(()=>window.__benchReady===true);
 await page.evaluate(()=>{document.querySelector('.ytp-skip-ad-button').remove();window.__benchStartAd(300);});
 await page.waitForTimeout(900);
 const s=await page.evaluate(()=>{
   const v=document.getElementById('video');
   const out={ct:v.currentTime,duration:v.duration,seeks:window.__seeks,scrollHeight:v.scrollHeight,
     skipAttr:document.documentElement.getAttribute('data-ytadclean-skip'),
     adShowing:document.getElementById('movie_player').classList.contains('ad-showing')};
   // direct write, straight after, to see whether it lands
   v.currentTime=123;
   out.afterManualWrite=v.currentTime;
   out.seeksAfter=window.__seeks;
   return out;
 });
 console.log(JSON.stringify(s,null,1));
 await ctx.close();
})();
