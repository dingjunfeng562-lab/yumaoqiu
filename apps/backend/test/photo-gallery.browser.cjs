// Run from repository root. Isolated browser fixtures do not modify user data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const { chromium } = require('../../../.codex-work/photo-access-qa/node_modules/playwright');
const dimensions = [[1600,900],[900,1600],[1200,900],[900,1200],[900,900],[1800,600]];
const photos = Array.from({length:36}, (_,i) => ({
  id:`photo-${i}`, seq:i+1, category:['PLAYER','MATCH','AWARD'][i%3],
  width:dimensions[i%6][0], height:dimensions[i%6][1],
  uploadedAt:new Date(Date.UTC(2026,9,16-Math.floor(i/12),12,0,36-i)).toISOString(),
  viewCount:100+i, downloadCount:50+i,
  url:`/api/photos/fixture/${i}.svg`, thumbUrl:`/api/photos/fixture/${i}.svg`, downloadUrl:`/api/photos/fixture/${i}/download`,
}));
(async () => {
  const output=path.resolve('outputs/photo-gallery-mobile-qa');
  await mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let failNext=false;
  await page.route('**/api/photos**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/photos/access/')) return route.fulfill({json:{id:'fixture',name:'羽毛球精彩瞬间 · 混合比例相册',startDate:photos[0].uploadedAt,endDate:photos[0].uploadedAt,photoCount:36}});
    if(url.pathname.includes('/fixture/')) {
      const index=Number(url.pathname.match(/fixture\/(\d+)/)[1]);
      const photo=photos[index];
      const body=`<svg xmlns="http://www.w3.org/2000/svg" width="${photo.width}" height="${photo.height}"><rect width="100%" height="100%" fill="${['#146482','#2c896e','#315aa5'][index%3]}"/><rect x="20" y="20" width="${photo.width-40}" height="${photo.height-40}" fill="none" stroke="white" stroke-width="10"/><path d="M0 0L${photo.width} ${photo.height}M${photo.width} 0L0 ${photo.height}" stroke="#ffffff33" stroke-width="8"/><text x="50%" y="45%" text-anchor="middle" fill="white" font-size="70">${photo.width} × ${photo.height}</text><text x="50%" y="60%" text-anchor="middle" fill="white" font-size="60">PHOTO ${index+1}</text></svg>`;
      return route.fulfill({contentType:'image/svg+xml',body,headers:url.pathname.endsWith('/download')?{'content-disposition':'attachment; filename="photo.svg"'}:{}});
    }
    if(url.pathname==='/api/photos') {
      if(failNext) {failNext=false; return route.fulfill({status:500,json:{error:'test failure'}});}
      let items=photos.filter(p=>!url.searchParams.has('category')||p.category===url.searchParams.get('category'));
      if(['POPULAR','DOWNLOADS'].includes(url.searchParams.get('sort'))) items=[...items].reverse();
      if(url.searchParams.get('direction')==='asc') items=[...items].reverse();
      const n=Number(url.searchParams.get('page')||1), size=Number(url.searchParams.get('pageSize')||30);
      return route.fulfill({json:{total:items.length,page:n,stats:{viewCount:5000,downloadCount:2000},items:items.slice((n-1)*size,n*size)}});
    }
    return route.continue();
  });
  async function menu(){await page.getByRole('button',{name:'浏览设置',exact:true}).click();}
  async function choose(label){await menu();await page.getByRole('radio',{name:label,exact:true}).click();}
  async function checkLayout(square=false){
    await page.waitForFunction(()=>document.querySelector('.photo-media')?.getBoundingClientRect().width>30);
    const cards=await page.locator('.photo-card').evaluateAll(nodes=>nodes.map(node=>{
      const img=node.querySelector('img'),media=node.querySelector('.photo-media').getBoundingClientRect(),rect=node.getBoundingClientRect();
      return {x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:media.width,height:media.height,ratio:Number(img.getAttribute('width'))/Number(img.getAttribute('height')),fit:getComputedStyle(img).objectFit,below:[...node.querySelectorAll('button')].slice(1).every(b=>b.getBoundingClientRect().top>=media.bottom-1)};
    }));
    for(const c of cards){assert.ok(Math.abs(c.width/c.height-(square?1:c.ratio))<.025,'Preserve photo ratio');assert.equal(c.fit,'contain');assert.equal(c.below,true,'Actions below image');}
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){const a=cards[i],b=cards[j];assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,'No card overlap');}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
  }
  async function first(id){await page.waitForFunction(id=>document.querySelector('.photo-card')?.dataset.photoId===id,id);}
  try{
    await page.goto(`http://localhost:3000/photos/${'a'.repeat(32)}`);
    await page.getByRole('button',{name:/进入.*照片墙/}).click();
    await page.locator('.photo-card').first().waitFor();
    for(const width of [320,390,430,768,1440]){await page.setViewportSize({width,height:900});await page.waitForTimeout(250);await checkLayout();await page.screenshot({path:path.join(output,`masonry-${width}.png`)});}
    await page.setViewportSize({width:390,height:844});
    await choose('九宫格');await checkLayout(true);await page.screenshot({path:path.join(output,'grid.png')});
    await choose('沉浸式');await checkLayout();
    await choose('时间线');await page.getByRole('heading',{name:'2026-10-16'}).waitFor();await checkLayout();await page.screenshot({path:path.join(output,'timeline.png')});
    await choose('瀑布流');await choose('正序');await first('photo-35');await choose('倒序');await first('photo-0');
    await page.getByRole('button',{name:'热门',exact:true}).click();await first('photo-35');
    await page.getByRole('button',{name:'照片',exact:true}).click();await first('photo-0');
    await menu();await page.getByRole('radio',{name:'九宫格',exact:true}).waitFor();await page.waitForTimeout(250);await page.screenshot({path:path.join(output,'settings.png')});
    await page.getByRole('radio',{name:'English',exact:true}).check();await page.getByRole('button',{name:'View settings',exact:true}).waitFor();
    await page.getByRole('radio',{name:'繁體',exact:true}).check();await page.getByRole('button',{name:'瀏覽設定',exact:true}).waitFor();
    await page.getByRole('radio',{name:'简体',exact:true}).check();await menu();
    const download=page.waitForEvent('download');await page.locator('.photo-card').first().getByRole('button',{name:'下载 1',exact:true}).click();assert.equal((await download).suggestedFilename(),'photo.svg');
    await menu();await page.getByRole('button',{name:'电影模式',exact:true}).click();await page.getByRole('button',{name:'暂停播放',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.ant-image-preview-img')?.getAttribute('src')?.includes('/1.svg'));
    await page.getByRole('button',{name:'暂停播放',exact:true}).click();const src=await page.locator('.ant-image-preview-img').getAttribute('src');await page.waitForTimeout(3800);assert.equal(await page.locator('.ant-image-preview-img').getAttribute('src'),src);
    for(let i=0;i<28;i++)await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>document.querySelector('.ant-image-preview-img')?.getAttribute('src')?.includes('/29.svg'));
    await page.getByRole('button',{name:'自动播放',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.ant-image-preview-img')?.getAttribute('src')?.includes('/30.svg'),null,{timeout:15000});
    await page.getByRole('button',{name:'暂停播放',exact:true}).click();
    await page.screenshot({path:path.join(output,'movie.png')});
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length===36);await checkLayout();
    await page.evaluate(()=>scrollTo(0,0));await page.getByRole('button',{name:'选手照',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length===12);
    failNext=true;await page.getByRole('button',{name:'颁奖照',exact:true}).click();await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length===12);
    assert.deepEqual(errors,[]);
    console.log('PASS: 5 screen widths, 6 ratios, no overlap, actions below photos, 4 layouts, 3 languages, sorting, download, movie play/pause/close, pagination, categories and error retry.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
