// A deterministic narrative dataset. No real sensors, device calls or random values.
export const dayEvents = [
 {minute:495,destination:'access',title:'อาคารเริ่มวันใหม่',detail:'อ่านทะเบียนและเปิดทางเข้า',layer:'none'},
 {minute:540,destination:'meeting',title:'เริ่มประชุม ชั้น 4',detail:'มีคน 6 คน · เปิดไฟและแอร์',layer:'occupancy'},
 {minute:720,destination:'energy',title:'แดดดีบนดาดฟ้า',detail:'โซลาร์ช่วยจ่ายไฟให้อาคาร',layer:'none'},
 {minute:870,destination:'meeting',title:'ห้องว่าง แต่แอร์ยังเปิด',detail:'ดูสถานะคนและแอร์ประกอบกัน',layer:'temperature'},
 {minute:900,destination:'pond',title:'ระดับน้ำลดลง',detail:'ตรวจสอบบ่อปลาที่ชั้น 1',layer:'none'},
 {minute:1080,destination:'overview',title:'อาคารหลังเลิกงาน',detail:'ปิดไฟและแอร์ในห้องทำงาน',layer:'none'}
];
const solarPoints=[[480,2.2],[540,4.5],[660,8.2],[720,9.4],[810,8.4],[900,5.8],[1020,1.1],[1080,0]];
const lerp=(points,t)=>{for(let i=1;i<points.length;i++){const[a,x]=points[i-1],[b,y]=points[i];if(t<=b)return x+(y-x)*Math.max(0,(t-a)/(b-a));}return points.at(-1)[1];};
const round=n=>Math.round(n*10)/10;
export const formatTime=minute=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(Math.floor(minute%60)).padStart(2,'0')}`;
export function incidentsFor(telemetry,rooms){
 const incidents=[];
 if(!telemetry.occupied&&rooms['f4_meeting_2']?.climate)incidents.push({id:'empty-ac',destination:'meeting',title:'ห้องว่าง แต่แอร์ยังเปิด',detail:'ห้องประชุมย่อย 2 ชั้น 4 · ไม่มีคน / แอร์เปิด',hint:'ตรวจสอบตารางใช้ห้องก่อนปิดแอร์',layer:'occupancy'});
 if(telemetry.water<65)incidents.push({id:'pond-low',destination:'pond',title:'ระดับน้ำบ่อต่ำ',detail:`บ่อปลา ชั้น 1 · ${telemetry.water}% / เกณฑ์ 65%`,hint:'ตรวจสอบบ่อและระบบเติมน้ำ',layer:'none'});
 return incidents;
}
export function daySnapshot(value,roomMap){
 const minute=Math.max(480,Math.min(1080,Number.isFinite(value)?Math.round(value):480));
 const occupied=minute>=540&&minute<840,working=minute>=510&&minute<1050;
 const meetingAC=minute>=530&&minute<885,meetingLight=minute>=535&&minute<850;
 const water=minute<890?82:minute<960?58:82;
 const temp=round(lerp([[480,28.1],[540,27.2],[600,24.6],[840,24.5],[885,23.8],[1080,28]],minute));
 const solar=round(lerp(solarPoints,minute));
 let energy=.8;for(let i=1;i<solarPoints.length;i++){const[a,x]=solarPoints[i-1],[b,y]=solarPoints[i];if(minute<=a)break;const end=Math.min(b,minute);energy+=(x+lerp([[a,x],[b,y]],end))*.5*(end-a)/60;}
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
 const telemetry={occupied,temp,target:24,pondAlert:water<65,water,solar,load:Math.max(load,solar+.5),energy:round(energy),barrierAngle:minute>=495&&minute<500?Math.PI/2:0,accessStep:minute<495?0:minute<500?3:4,scenario:null,roomData};
 return {minute,rooms,night:minute>=1080,telemetry};
}
export function dayHistory(minute,rooms,key){
 const end=Math.max(480,Math.min(1080,minute)),steps=7;
 const times=Array.from({length:steps},(_,i)=>Math.round(480+(end-480)*i/(steps-1)));
 return {values:times.map(t=>daySnapshot(t,rooms).telemetry[key]),labels:[formatTime(480),formatTime(end)]};
}
