import * as ExcelJS from 'exceljs';
import { buildOrderbookWorkbook } from './src/exports/orderbook-workbook';
import type { ExportTournament } from './src/exports/exports.service';

// 覆盖所有区块：秩序表 + 第一阶段网格 + 真实淘汰树 + 骨架 + 前8晋级赛
function reg(eid:string,id:string,n:string,g:string|null,p?:string){return{id,eventId:eid,studentId:null,createdAt:new Date('2026-12-01'),className:null,groupName:g,teamName:null,isSeed:false,seedRank:null,player1:{name:n,gender:'MALE',affiliation:'院',contact:null},player2:p?{name:p,gender:'MALE',affiliation:'院',contact:null}:null,competitionRegistration:null};}
function gm(eid:string,id:string,round:string,rno:number,mno:number,s1:string|null,s2:string|null,o:any={}){return{id,round,roundNo:rno,matchNo:mno,venueId:o.v??'v1',scheduledAt:o.t??new Date('2026-12-06T09:00:00'),status:o.status??'PENDING',durationMinutes:30,side1Id:s1,side2Id:s2,winnerSide:o.winnerSide??null,updatedAt:new Date(),venue:{name:(o.v==='v2'?'2号':'1号'),sortOrder:o.v==='v2'?2:1},referee:null,games:o.games??[]};}

// 事件1：STD，有小组赛(roundNo0)无淘汰 → 第一阶段网格 + 第二阶段骨架
const e1='md';
const r1=['a1','a2','a3','b1','b2','b3','c1','c2','c3','d1','d2','d3'].map((id,i)=>reg(e1,id,'选'+i,'ABCD'[Math.floor(i/3)]));
const m1=[gm(e1,'A1','A',0,1,'a1','a2',{status:'COMPLETED',winnerSide:1,games:[{gameNo:1,side1Score:21,side2Score:10}]}),gm(e1,'A2','A',0,2,'a1','a3'),gm(e1,'A3','A',0,3,'a2','a3'),
 gm(e1,'B1','B',0,1,'b1','b2'),gm(e1,'C1','C',0,1,'c1','c2'),gm(e1,'D1','D',0,1,'d1','d2',{v:'v2'})];

// 事件2：单淘汰真实树
const e2='ms';
const r2=[reg(e2,'s1','单1',null),reg(e2,'s2','单2',null),reg(e2,'s3','单3',null),reg(e2,'s4','单4',null)];
const m2=[gm(e2,'sf1','SF',1,1,'s1','s2',{t:new Date('2026-12-06T09:00:00')}),gm(e2,'sf2','SF',1,2,'s3','s4',{t:new Date('2026-12-06T09:00:00'),v:'v2'}),
 gm(e2,'f','F',2,1,'s1','s3',{t:new Date('2026-12-06T10:00:00'),status:'COMPLETED',winnerSide:1,games:[{gameNo:1,side1Score:21,side2Score:18}]}),gm(e2,'br','BRONZE',2,2,'s2','s4',{t:new Date('2026-12-06T10:00:00')})];

// 事件3：前8晋级赛 SecondStage
const e3='wd';
const r3=Array.from({length:8},(_,i)=>reg(e3,'e'+i,'女'+i,null));
const ssMatch=(no:number,s1s:string,s2s:string,o:any={})=>({matchNo:no,roundName:'R',area:'1',slotInfo:null,side1Source:s1s,side2Source:s2s,side1Id:o.s1??null,side2Id:o.s2??null,side1NameSnapshot:o.n1??null,side2NameSnapshot:o.n2??null,score:o.score??null,status:o.status??'PENDING',winnerSide:o.w??null,winnerId:null,winnerNameSnapshot:null});
const ss={status:'CONFIRMED',mode:'MANUAL_BY_REFEREE',rankingMode:'TOP_8',
 slots:'ABCDEFGH'.split('').map((s,i)=>({slot:s,sortOrder:i,entrantId:'e'+i,entrantNameSnapshot:'女'+i})),
 matches:[ssMatch(1,'A','B',{s1:'e0',s2:'e1',score:'21:15',status:'COMPLETED',w:1}),ssMatch(2,'C','D',{s1:'e2',s2:'e3'}),ssMatch(3,'E','F',{s1:'e4',s2:'e5'}),ssMatch(4,'G','H',{s1:'e6',s2:'e7'}),ssMatch(5,'1胜','2胜'),ssMatch(6,'3胜','4胜'),ssMatch(7,'5胜','6胜'),ssMatch(8,'5负','6负'),ssMatch(9,'1负','2负'),ssMatch(10,'3负','4负'),ssMatch(11,'9胜','10胜'),ssMatch(12,'9负','10负')],
 rankings:[{rank:1,entrantId:'e0',entrantNameSnapshot:'女0'}]};

const t={name:'测试杯',startDate:new Date('2026-12-06'),endDate:new Date('2026-12-07'),
 venues:[{id:'v1',name:'1号',sortOrder:1},{id:'v2',name:'2号',sortOrder:2}],
 events:[{type:'MENS_DOUBLES',format:'GROUP_PLUS_KNOCKOUT_STD',qualifiersPerGroup:2,registrations:r1,matches:m1},
   {type:'MENS_SINGLES',format:'SINGLE_ELIMINATION',qualifiersPerGroup:null,registrations:r2,matches:m2},
   {type:'WOMENS_DOUBLES',format:'SINGLE_ELIMINATION_PLUS_GROUP_RANKING',qualifiersPerGroup:null,registrations:r3,matches:[],secondStage:ss}]} as unknown as ExportTournament;

function rangeOverlap(a:any,b:any){return a.left<=b.right&&b.left<=a.right&&a.top<=b.bottom&&b.top<=a.bottom;}
(async()=>{
  const buf=await buildOrderbookWorkbook(t);
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
  let totalOverlaps=0;
  for(const ws of wb.worksheets){
    const merges:any[]=Object.values((ws as any)._merges ?? {}).map((m:any)=>m.model ?? m);
    // fallback: ws.model.merges is array of "A1:B2"
    const ranges:any[] = ((ws.model as any).merges ?? []).map((s:string)=>{
      const [tl,br]=s.split(':'); const dc=(c:string)=>{const mm=c.match(/^([A-Z]+)(\d+)$/)!;let col=0;for(const ch of mm[1])col=col*26+ch.charCodeAt(0)-64;return{col,row:+mm[2]};};
      const a=dc(tl),b=dc(br);return{left:a.col,top:a.row,right:b.col,bottom:b.row,s};
    });
    let sheetOverlap=0;
    for(let i=0;i<ranges.length;i++)for(let j=i+1;j<ranges.length;j++)if(rangeOverlap(ranges[i],ranges[j])){sheetOverlap++;totalOverlaps++;if(sheetOverlap<=8)console.log(`[${ws.name}] OVERLAP ${ranges[i].s} <> ${ranges[j].s}`);}
    console.log(`sheet ${ws.name}: ${ranges.length} merges, ${sheetOverlap} overlaps`);
  }
  console.log('\nTOTAL OVERLAPS:', totalOverlaps);
  require('fs').writeFileSync('_check.xlsx', buf);
  process.exit(totalOverlaps?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
