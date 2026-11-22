const fs=require('fs');
const {chromium}=require('/home/user/.npm/_npx/f0a362733743bae2/node_modules/playwright-core');
(async()=>{
 const d=fs.mkdtempSync('/tmp/ytprobe2-');
 const ctx=await chromium.launchPersistentContext(d,{headless:true,executablePath:process.env.HOME+'/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
  args:['--disable-extensions-except=/home/user/yt-adblock','--load-extension=/home/user/yt-adblock','--ignore-certificate-errors','--no-sandbox',
   '--host-resolver-rules=MAP www.youtube.com 127.0.0.1:8443, MAP *.youtube.com 127.0.0.1:8443']});
 const page=await ctx.newPage();
 page.on('console',m=>console.log('CONSOLE',m.type(),m.text().slice(0,200)));
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,200)));
 await page.goto('https://www.youtube.com/watch?v=realvideo',{waitUntil:'load'});
 await page.waitForFunction(()=>window.__benchReady===true);
 // does the setter intercept a write at all?
 const t1=await page.evaluate(()=>{const v=document.getElementById('video');v.currentTime=42;return {ct:v.currentTime,seeks:window.__seeks};});
 console.log('setter intercept:',JSON.stringify(t1));
 await page.evaluate(()=>{window.__seeks.length=0;});
 await page.evaluate(()=>window.__benchStartAd(300));
 await page.waitForTimeout(900);
 const t2=await page.evaluate(()=>{
   const v=document.getElementById('video');
   return {ct:v.currentTime,duration:v.duration,seeks:window.__seeks,
     scrollHeight:v.scrollHeight,
     isConnected:v.isConnected,
     html:v.outerHTML.slice(0,120),
     attrs:document.documentElement.getAttribute('data-ytadclean-skip')};
 });
 console.log('after ad tick:',JSON.stringify(t2));
 await ctx.close();
})();
