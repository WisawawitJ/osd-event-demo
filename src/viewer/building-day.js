import {L} from 'osd/parking/i18n.js';
import {sunAt} from 'osd/viewer/daylight.js';
// The building's day on the world clock (src/parking/clock.js): what the rooms, the meeting room, the pond and the
// solar panels do at each time of day. A deterministic schedule that repeats every day: no real sensors, device
// calls or random values. Titles and details follow the TH/EN switch (getters), so a re-render picks up the language.
const event=(minute,destination,layer,title,detail)=>({minute,destination,layer,get title(){return L(...title);},get detail(){return L(...detail);}});
// Moments worth a look, in time order: the timeline's buttons and the "Follow the day" camera (and its footer line).
export const dayEvents = [
 event(450,'parking','none',['รถเข้างานช่วงเช้า','Morning arrivals'],['รถพนักงานทยอยเข้าลานจอด','Staff cars stream into the car park']),
 event(540,'meeting','occupancy',['เริ่มประชุม ชั้น 4','Meeting starts, floor 4'],['มีคน 6 คน · เปิดไฟและแอร์','6 people · lights and AC on']),
 event(720,'energy','none',['แดดดีบนดาดฟ้า','Strong sun on the roof'],['โซลาร์ช่วยจ่ายไฟให้อาคาร','Solar helps power the building']),
 event(870,'meeting','temperature',['ห้องว่าง แต่แอร์ยังเปิด','Room empty, AC still on'],['ดูสถานะคนและแอร์ประกอบกัน','Compare occupancy with the AC']),
 event(900,'pond','none',['ระดับน้ำลดลง','Water level dropping'],['ตรวจสอบบ่อปลาที่ชั้น 1','Check the fish pond on floor 1']),
 event(1020,'parking','none',['รถออกช่วงเย็น','Evening departures'],['ลานจอดค่อย ๆ ว่างลง','The car park empties']),
 event(1080,'overview','none',['อาคารหลังเลิกงาน','After hours'],['ปิดไฟและแอร์ในห้องทำงาน','Office lights and AC off'])
];
const lerp=(points,t)=>{for(let i=1;i<points.length;i++){const[a,x]=points[i-1],[b,y]=points[i];if(t<=b)return x+(y-x)*Math.max(0,(t-a)/(b-a));}return points.at(-1)[1];};
const round=n=>Math.round(n*10)/10;
const dayMinute=value=>(((Number.isFinite(value)?Math.round(value):0)%1440)+1440)%1440;
// The minute it is (floored, as a clock and the timeline's slider show it: 23:59:45 is 23:59).
export const formatTime=minute=>{const m=dayMinute(Math.floor(minute));return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;};
// Solar output follows the sun's height: 9.4 kW at noon, nothing before sunrise or after sunset.
const solarAt=minute=>round(9.4*Math.pow(sunAt(minute).height,1.15));
export function incidentsFor(telemetry,rooms){
 const incidents=[];
 if(!telemetry.occupied&&rooms['f4_meeting_2']?.climate)incidents.push({id:'empty-ac',destination:'meeting',title:L('ห้องว่าง แต่แอร์ยังเปิด','Room empty, AC still on'),detail:L('ห้องประชุมย่อย 2 ชั้น 4 · ไม่มีคน / แอร์เปิด','Meeting room 2, floor 4 · nobody in / AC on'),hint:L('ตรวจสอบตารางใช้ห้องก่อนปิดแอร์','Check the room booking before turning the AC off'),layer:'occupancy'});
 if(telemetry.water<65)incidents.push({id:'pond-low',destination:'pond',title:L('ระดับน้ำบ่อต่ำ','Pond water low'),detail:L(`บ่อปลา ชั้น 1 · ${telemetry.water}% / เกณฑ์ 65%`,`Fish pond, floor 1 · ${telemetry.water}% / threshold 65%`),hint:L('ตรวจสอบบ่อและระบบเติมน้ำ','Check the pond and the refill system'),layer:'none'});
 return incidents;
}
// The building at a time of day: each room's light, AC and doors, and the readings (telemetry) the panels show.
export function daySnapshot(value,roomMap){
 const minute=dayMinute(value);
 const occupied=minute>=540&&minute<840,working=minute>=510&&minute<1050;
 const meetingAC=minute>=530&&minute<885,meetingLight=minute>=535&&minute<850;
 const water=minute>=890&&minute<960?58:82;
 const temp=round(lerp([[0,27.4],[480,28.1],[540,27.2],[600,24.6],[840,24.5],[885,23.8],[1080,28],[1440,27.4]],minute));
 const solar=solarAt(minute);
 // Energy produced today: solar output summed in 10-minute steps since midnight, plus a small night-time baseline.
 let energy=.8;for(let t=0;t<minute;t+=10)energy+=solarAt(t+5)*Math.min(10,minute-t)/60;
 const rooms={},roomData={};
 for(const [index,room] of roomMap.entries()){
  const meeting=room.id==='f4_meeting_2';
  const light=room.capabilities?.light!==false&&(meeting?meetingLight:working||room.id==='f1_lobby');
  const climate=room.capabilities?.climate!==false&&(meeting?meetingAC:working&&index%3!==0);
  const people=meeting?(occupied?6:0):(working&&room.capabilities?.climate!==false?1+index%4:0);
  rooms[room.id]={light,climate,doors:Object.fromEntries((room.doorIds||[]).map(id=>[id,meeting&&minute>=535&&minute<540]))};
  roomData[room.id]={people,temp:meeting?temp:round((climate?24.5:27.2)+(index%5)*.4)};
 }
 const activeAC=Object.values(rooms).filter(r=>r.climate).length,activeLights=Object.values(rooms).filter(r=>r.light).length;
 const load=round(4.2+activeAC*.65+activeLights*.14);
 const telemetry={occupied,temp,target:24,pondAlert:water<65,water,solar,load:Math.max(load,solar+.5),energy:round(energy),roomData};
 return {minute,rooms,telemetry};
}
// The last eight hours of one reading, for the panels' charts.
export function dayHistory(minute,rooms,key){
 const end=Math.round(minute),start=end-480,steps=7;
 const times=Array.from({length:steps},(_,i)=>Math.round(start+(end-start)*i/(steps-1)));
 return {values:times.map(t=>daySnapshot(t,rooms).telemetry[key]),labels:[formatTime(start),formatTime(end)]};
}
// Keeps the building's rooms on the schedule: each call (with the clock's minute) applies only what the schedule changed
// since the last call, so a light or AC switched by hand stays until the schedule next changes that room. `all`
// re-applies every room (a jump in time, or a reset). Returns whether anything changed.
export function createRoomSchedule(simulation){
 let applied=null;
 return (minute,{all=false}={})=>{
  const next=daySnapshot(minute,simulation.rooms).rooms,changes={};
  for(const [id,room] of Object.entries(next)){
   const before=applied?.[id],patch={};
   for(const key of ['light','climate'])if(all||!before||before[key]!==room[key])patch[key]=room[key];
   const doors=Object.fromEntries(Object.entries(room.doors).filter(([door,open])=>all||!before||before.doors[door]!==open));
   if(Object.keys(doors).length)patch.doors=doors;
   if(Object.keys(patch).length)changes[id]=patch;
  }
  applied=next;
  if(!Object.keys(changes).length)return false;
  simulation.applySnapshot({rooms:changes});
  return true;
 };
}
