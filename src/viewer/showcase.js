import {createBuildingInsights} from 'osd/viewer/building-insights.js';
import {createTourEffects} from 'osd/viewer/tour-effects.js';
import {t as pt, onLang, getLang} from 'osd/parking/i18n.js';
const icons={building:'M3 21V5h12v16M15 11h6v10M7 9h4M7 13h4M7 17h4',light:'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9Z',air:'M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h5',people:'M4 21v-3a5 5 0 0 1 10 0v3m3-9a4 4 0 0 1 4 4v5M12 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',water:'M12 3S6 10 6 14a6 6 0 0 0 12 0c0-4-6-11-6-11Z',solar:'m5 9-2 10h18L19 9ZM8 9l-1 10m9-10 1 10M4 14h16M12 19v3M12 2v3M5 3l2 2m12-2-2 2',door:'M5 21V3h14v18M9 21V5l8 2v14M13 13h.01',arrow:'M4 12h16m-5-5 5 5-5 5',play:'m8 5 11 7-11 7Z',pause:'M8 5v14M16 5v14',check:'m5 12 4 4L19 6'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.building}"/></svg>`;
const destinations={
 overview:{title:'ทุกระบบ\nในมุมมองเดียว',description:'สำรวจอาคาร OSD ผ่านข้อมูลที่เชื่อมถึงกัน',panel:'ภาพรวมอาคาร',floor:'ทั้งอาคาร',chip:'โมเดลอาคาร OSD · 5 ระดับ'},
 meeting:{title:'พื้นที่ที่พร้อม\nสำหรับทุกไอเดีย',description:'แสง อากาศ และการใช้ห้อง เชื่อมกันอย่างพอดี',panel:'ห้องประชุม',floor:'ชั้น 4',chip:'ห้องประชุมย่อย 2 ชั้น 4 · แตะไฟ แอร์ หรือประตูเพื่อทดลอง'},
 pond:{title:'รายละเอียดเล็ก ๆ\nที่ดูแลได้ตลอด',description:'มองเห็นความเปลี่ยนแปลงของน้ำ ก่อนเป็นปัญหา',panel:'บ่อปลาและสวน',floor:'ชั้น 1',chip:'บ่อปลาริมห้องประชุม · เซ็นเซอร์จำลอง'},
 energy:{title:'พลังงานจากหลังคา\nสู่ทั้งอาคาร',description:'เห็นการผลิตและการใช้ไฟในภาพเดียว',panel:'พลังงานอาคาร',floor:'ดาดฟ้า',chip:'24 แผง · กำลังผลิตเป็นค่าจำลอง'},
 access:{title:'ทุกการเข้าออก\nมีเรื่องราว',description:'เชื่อมภาพ เหตุการณ์ และสถานะทางเข้า',panel:'ทางเข้าที่จอดรถ',floor:'ชั้น 1',chip:'ไม้กั้นริมขอบพื้นที่ · ช่องทางเข้าออกตามลูกศร'},
 // Parking access demo (src/parking): its texts follow the TH/EN switch.
 parking:{get title(){return pt('parking.title')},get description(){return pt('parking.description')},get panel(){return pt('parking.panel')},get floor(){return pt('parking.floor')},get chip(){return pt('parking.chip')}}
};
// The tour visits the car park right after the overview; the dock keeps it last.
const order=['overview','parking','meeting','pond','energy','access'],meetingId='f4_meeting_2';
const initial=()=>({occupied:true,temp:25.6,target:24,pondAlert:false,water:82,solar:8.4,load:12.6,energy:37.8,barrierAngle:0,accessStep:0,scenario:null});
export function createShowcase({model,simulation,navigate,cancelFlight,snapshot,schedule,onUserOrbit,parking=null}){
 const abort=new AbortController(),signal=abort.signal,effects=createTourEffects({model,schedule,meetingRoom:simulation.rooms.find(r=>r.id===meetingId)});
 const $=s=>document.querySelector(s),content=$('#dashboard-content'),play=$('#tour-play');
 let tourGeneration=0,insights=null;
 let traveling=false,pendingDestination=null;
 let destination='overview',state=initial(),tourTimer=0,scenarioFrame=0,scenarioStart=0,touring=false,disposed=false,sequence=0,cameraImage='',lastPreview=0,lastTick=0;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const listen=(el,event,fn)=>el.addEventListener(event,fn,{signal});
 const actual=()=>simulation.getState().rooms[meetingId];
 function row(label,value){return `<div class="data-row"><span>${label}</span><strong>${value}</strong></div>`;}
 function metric(label,value,unit,note=''){return `<div><span class="metric-label">${label}</span><div class="metric-value">${value}<small>${unit}</small></div>${note?`<span class="metric-note">${note}</span>`:''}</div>`;}
 function system(name,title,desc,value){return `<div class="system-row"><div class="system-icon">${icon(name)}</div><div class="system-copy"><strong>${title}</strong><span>${desc}</span></div><span class="system-value">${value}</span></div>`;}
 function chart(values,labels=['08:00','10:00','12:00','14:00'],unit='',historyKey=null){const history=historyKey&&insights?.history(historyKey);if(history){values=history.values;labels=history.labels;}const min=Math.min(...values)-1,max=Math.max(...values)+1;const points=values.map((v,i)=>[i*280/(values.length-1),74-(v-min)/(max-min)*60]);return `<svg class="chart" viewBox="0 0 280 100" role="img" aria-label="กราฟตัวอย่าง ${unit}"><path class="chart-grid" d="M0 18h280M0 46h280M0 74h280"/><path d="M${points.map(p=>p.join(',')).join(' L')} L280,82 L0,82Z" fill="#e9effd" stroke="none"/><path class="chart-line" d="M${points.map(p=>p.join(',')).join(' L')}"/>${labels.map((l,i)=>`<text x="${i*280/(labels.length-1)}" y="98" text-anchor="${i===0?'start':i===labels.length-1?'end':'middle'}">${l}</text>`).join('')}</svg>`;}
 function events(items){return items.map(([time,text])=>`<div class="event-row"><time>${time}</time><p>${text}</p></div>`).join('');}
 function controls(){const s=actual(),door=Object.values(s.doors).some(Boolean);return `<div class="local-controls"><button data-control="light" aria-pressed="${s.light}">${icon('light')}ไฟ ${s.light?'เปิด':'ปิด'}</button><button data-control="climate" aria-pressed="${s.climate}">${icon('air')}แอร์ ${s.climate?'เปิด':'ปิด'}</button><button data-control="door" aria-pressed="${door}">${icon('door')}ประตู ${door?'เปิด':'ปิด'}</button></div>`;}
 function render(){
  if(disposed)return;const s=actual(),sim=simulation.getState(),d=destinations[destination];
  const focused=document.activeElement?.dataset?.control||document.activeElement?.dataset?.action;
  const lights=Object.values(sim.rooms).filter(r=>r.light).length,ac=Object.values(sim.rooms).filter(r=>r.climate).length;
  effects.update({...state,climate:s.climate});
  if(destination==='access'&&!traveling&&(!cameraImage||performance.now()-lastPreview>=400)){cameraImage=snapshot(effects.securityCamera);lastPreview=performance.now();}
  $('#panel-title').textContent=d.panel;
  $('#panel-status').textContent=destination==='pond'&&state.pondAlert?'ควรตรวจสอบ':destination==='meeting'?(state.occupied?'มีคนใช้งาน':'ห้องว่าง'):destination==='access'?['พร้อมสาธิต','อ่านทะเบียนแล้ว','อนุญาตผ่าน','ไม้กั้นเปิด','ผ่านเรียบร้อย'][state.accessStep]:'ข้อมูลจำลอง';
  if(destination==='parking')$('#panel-status').textContent=pt('sim.data');
  $('#panel-status').classList.toggle('attention',destination==='pond'&&state.pondAlert);
  if(destination==='overview')content.innerHTML=`<p class="dashboard-intro">มองเห็นสิ่งที่เกิดขึ้นในอาคาร แล้วไปยังจุดที่ต้องการได้ทันที</p><div class="metric-pair">${metric('พลังงานจากโซลาร์',state.solar.toFixed(1),'kW',insights?.timeLabel()||(sim.night?'ข้อมูลตัวอย่าง ณ เวลา 22:00':'ข้อมูลตัวอย่าง ณ เวลา 13:30'))}${metric('ห้องประชุมตัวอย่าง',state.occupied?'ใช้งาน':'ว่าง','','สถานะจาก radar จำลอง')}</div><div class="dashboard-section"><h3>ระบบในอาคาร</h3>${system('light','แสงสว่าง','วงจรไฟในโมเดล',`${lights} เปิด`)}${system('air','เครื่องปรับอากาศ','สถานะในตัวจำลอง',`${ac} เปิด`)}${system('water','บ่อปลา',state.pondAlert?'ระดับน้ำต่ำกว่าค่าที่ตั้ง':'ระดับน้ำอยู่ในช่วงที่ตั้ง',state.water+'%')}</div><div class="dashboard-section"><h3>จุดที่น่าสนใจ</h3>${events([['ห้องประชุม','แตะห้องประชุมเพื่อทดลองไฟและแอร์'],['ดาดฟ้า','ดูเส้นทางพลังงานจากแผงโซลาร์'],['ทางเข้า','เล่นเหตุการณ์ทะเบียนและไม้กั้น']])}</div><button class="panel-action" data-action="tour">${icon('play')}พาชมทุกระบบ</button>`;
  if(destination==='meeting')content.innerHTML=`<p class="dashboard-intro">ห้องประชุมย่อย 2 ชั้น 4 · แสงและอากาศที่ปรับให้เข้ากับการใช้งาน</p><div class="metric-pair">${metric('อุณหภูมิห้อง',state.temp.toFixed(1),'°C')}${metric('ตั้งอุณหภูมิ',state.target,'°C')}</div><div class="dashboard-section">${row('การใช้งาน',state.occupied?'มีคนอยู่ · 6 คนจำลอง':'ไม่มีคน')}${row('แอร์',s.climate?'เปิดโหมดเย็น':'ปิด')}${row('ประตู',Object.values(s.doors).some(Boolean)?'เปิด':'ปิด')}</div>${controls()}<div class="dashboard-section"><h3>แนวโน้มอุณหภูมิ · ตัวอย่าง</h3>${chart([27.5,27.2,26.8,26.2,25.9,state.temp],['เริ่ม','5 นาที','10 นาที','ตอนนี้'],'อุณหภูมิ','temp')}<div class="chart-caption"><span>${insights?.timeLabel()||'อุณหภูมิห้อง'}</span><span>เป้าหมาย ${state.target} °C</span></div></div><button class="panel-action" data-action="meeting">${icon('play')}จำลองเริ่มประชุม</button><p class="scenario-note">${state.scenario==='meeting'?'กำลังจำลองการทำความเย็น · เร่งเวลาเพื่อสาธิต':'จุดสีเขียวเป็นตำแหน่งคนสมมติ ไม่ใช่ผลติดตามบุคคลจริง'}</p>`;
  if(destination==='pond')content.innerHTML=`<p class="dashboard-intro">ข้อมูลน้ำและสภาพแวดล้อมของบ่อปลาริมห้องประชุม</p><div class="metric-pair">${metric('ระดับน้ำ',state.water,'%')}${metric('อุณหภูมิน้ำ','27.1','°C')}</div><div class="water-level ${state.pondAlert?'warning':''}" aria-label="ระดับน้ำ ${state.water}%">${Array.from({length:12},(_,i)=>`<i class="${i<Math.round(state.water/100*12)?'filled':''}"></i>`).join('')}</div>${state.pondAlert?'<div class="alert-strip">ระดับน้ำต่ำ · ตรวจสอบบ่อและระบบเติมน้ำ<br>เหตุการณ์จำลอง ไม่ได้สั่งปั๊มน้ำ</div>':''}<div class="dashboard-section">${row('ความเป็นกรด–ด่าง','pH 7.2')}${row('ออกซิเจนละลายน้ำ','6.4 mg/L')}${row('สถานะปั๊มจำลอง','ทำงาน')}${row('เกณฑ์ระดับน้ำในเดโม','เตือนเมื่อ < 65%')}</div><div class="dashboard-section"><h3>ระดับน้ำ · ตัวอย่างวันนี้</h3>${chart([81,83,82,81,82,state.water],['08:00','10:00','12:00','13:30'],'ระดับน้ำ','water')}</div><button class="panel-action" data-action="pond">${icon(state.pondAlert?'check':'water')}${state.pondAlert?'คืนค่าระดับน้ำ':'จำลองระดับน้ำต่ำ'}</button><p class="scenario-note">ค่าคุณภาพน้ำและเกณฑ์แจ้งเตือนเป็นตัวอย่างสำหรับเดโม</p>`;
  if(destination==='energy')content.innerHTML=`<p class="dashboard-intro">แผงโซลาร์ 24 แผง · เห็นแหล่งที่มาของพลังงานอาคาร</p><div class="metric-pair">${metric('ผลิตอยู่ตอนนี้',state.solar.toFixed(1),'kW')}${metric('ผลิตสะสมวันนี้',state.energy.toFixed(1),'kWh')}</div><div class="energy-flow"><div class="energy-node">${icon('solar')}<strong>${state.solar.toFixed(1)} kW</strong><span>โซลาร์</span></div><span class="flow-arrow">${icon('arrow')}</span><div class="energy-node">${icon('building')}<strong>${state.load.toFixed(1)} kW</strong><span>อาคาร</span></div></div>${row('รับไฟจากกริด',(state.load-state.solar).toFixed(1)+' kW')}${row('สัดส่วนไฟจากโซลาร์',Math.round(state.solar/state.load*100)+'%')}<div class="dashboard-section"><h3>กำลังผลิต · ตัวอย่างวันนี้</h3>${chart([0,.4,2.3,5.1,7.4,9.1,state.solar,7.7,5.8,2.4,0],['06:00','10:00','14:00','18:00'],'กำลังผลิตโซลาร์','solar')}<div class="chart-caption"><span>${insights?.timeLabel()||'Solar production'}</span><span>kW</span></div></div><button class="panel-action" data-action="energy">${icon('solar')}${state.solar<5?'จำลองแดดกลับมา':'จำลองเมฆบังแผง'}</button><p class="scenario-note">ตัวเลขเป็นตัวอย่าง ไม่ใช่กำลังผลิตที่คำนวณจากสเปกแผงจริง</p>`;
  if(destination==='access')content.innerHTML=`<div class="camera-preview">${cameraImage?`<img src="${cameraImage}" alt="ภาพจำลองจากจุดติดตั้งกล้องไม้กั้น">`:''}<span>มุมกล้องทางรถเข้า · ภาพจำลอง</span></div><div class="plate">กข 1234<small>ทะเบียนตัวอย่าง · กรุงเทพมหานคร</small></div><div class="dashboard-section">${row('ผลอ่านทะเบียน',state.accessStep?'พบทะเบียนตัวอย่าง':'รอเหตุการณ์')}${row('สิทธิ์เข้าอาคาร',state.accessStep>=2?'อนุญาต · รายการจำลอง':'ยังไม่ตรวจสอบ')}${row('ไม้กั้น',state.barrierAngle>.1?'เปิด / กำลังเคลื่อน':'ปิด')}${row('Face recognition','ผู้มาติดต่อ A · ตัวอย่าง')}</div><div class="dashboard-section"><h3>ลำดับเหตุการณ์จำลอง</h3>${events(insights?.isReplaying()?(state.accessStep===0?[['08:00','ยังไม่มีรถผ่านทางเข้า']]:[['08:15','อ่านทะเบียน กข 1234 และอนุญาตผ่าน'],...(state.accessStep>=4?[['08:20','ปิดไม้กั้นหลังรถผ่าน']]:[])]):state.accessStep===0?[['พร้อมสาธิต','กดปุ่มเพื่อเล่นเหตุการณ์รถเข้า']]:[['13:30:02','อ่านทะเบียน กข 1234'],...(state.accessStep>=2?[['13:30:03','ตรวจสิทธิ์ผ่าน']]:[]),...(state.accessStep>=3?[['13:30:04','ไม้กั้นเปิดให้รถผ่าน']]:[]),...(state.accessStep>=4?[['13:30:09','ปิดไม้กั้นหลังรถผ่าน']]:[])])}</div><button class="panel-action" data-action="access">${icon('play')}จำลองรถผ่านทางเข้า</button><p class="scenario-note">ไม่มีการวิเคราะห์ใบหน้าหรือทะเบียนจริงในเดโมนี้</p>`;
  const action=content.querySelector('.panel-action'),section=content.querySelector('.dashboard-section');if(destination!=='overview'&&action&&section)content.insertBefore(action,section);
  if(focused)content.querySelector(`[data-control="${focused}"],[data-action="${focused}"]`)?.focus({preventScroll:true});
  $('#tour-night').setAttribute('aria-pressed',String(sim.night));
  $('#tour-night span').textContent=sim.night?'กลางวัน':'กลางคืน';
  const replaying=insights?.isReplaying()||false;content.querySelectorAll('[data-control],[data-action]').forEach(b=>b.disabled=replaying);
  content.inert=traveling;content.setAttribute('aria-busy',String(traveling));$('#tour-night').disabled=traveling||replaying;
  if(traveling)$('#panel-status').textContent='กำลังเดินทาง';
  if(!traveling)$('#scene-chip').textContent=replaying?`${d.floor} · ${d.panel} · ${insights.timeLabel()}`:d.chip;
  insights?.update({destination,traveling,state,sim});
 }
 function stopScenario(){cancelAnimationFrame(scenarioFrame);scenarioFrame=0;if(state.scenario==='access'){state.barrierAngle=0;state.accessStep=0;}state.scenario=null;}
 function stopTour(message='หยุดพาชมแล้ว · เลือกจุดต่อไปได้เอง'){if(touring)parking?.stopStory();tourGeneration++;clearTimeout(tourTimer);tourTimer=0;touring=false;play.innerHTML=icon('play')+'<span>เริ่มพาชม</span>';$('#tour-progress').textContent=message;}
 async function select(id,{guided=false,instant=false}={}){
  if(!destinations[id]||disposed)return false;if(!guided){insights?.pause();stopTour('เลือกจุดที่สนใจ หรือให้เราพาชม');}stopScenario();const ticket=++sequence,d=destinations[id];
  if(destination==='parking'&&id!=='parking')parking?.exit();
  traveling=true;pendingDestination=id;effects.select(null);render();
  document.querySelectorAll('[data-destination]').forEach(b=>b.setAttribute('aria-busy',String(b.dataset.destination===id)));
  const arrived=await navigate(id,{instant,onPhase(phase){if(ticket===sequence){$('#scene-chip').textContent=`${phase} → ${d.floor} · ${d.panel}`;$('#flight-status').textContent=`กำลังไป ${d.floor} · ${d.panel}`;}}});
  if(disposed||ticket!==sequence)return false;
  traveling=false;pendingDestination=null;document.querySelectorAll('[data-destination]').forEach(b=>b.removeAttribute('aria-busy'));
  if(!arrived){$('#scene-chip').textContent='หยุดการบินแล้ว · หมุนสำรวจหรือเลือกจุดต่อไป';effects.select(destination);if(destination==='parking'&&!parking?.active)parking?.enter();render();return false;}
  destination=id;document.body.dataset.tourDestination=id;$('#scene-heading').textContent=d.title;$('#scene-description').textContent=d.description;$('#scene-floor').textContent=d.floor;$('#scene-chip').textContent=d.chip;
  document.querySelectorAll('[data-destination]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.destination===id)));
  effects.select(id);if(id==='access')cameraImage='';if(id==='parking')parking?.enter();render();return true;
 }

 function scenario(kind){
  if(traveling||insights?.isReplaying())return;
  stopScenario();state.scenario=kind;scenarioStart=performance.now();lastTick=-1;let lastVisual=0;
  if(kind==='meeting'){state.occupied=true;state.temp=27.4;simulation.selectRoom(meetingId);simulation.setRoom(meetingId,{light:true,climate:true});}
  if(kind==='pond'){state.pondAlert=!state.pondAlert;state.water=state.pondAlert?58:82;state.scenario=null;render();return;}
  if(kind==='energy'){if(simulation.getState().night)simulation.setNight(false);state.solar=state.solar<5?8.4:3.1;}
  if(kind==='access'){state.accessStep=1;state.barrierAngle=0;}
  render();
  function tick(time){if(disposed||document.hidden)return;const elapsed=(time-scenarioStart)/1000,limit=kind==='meeting'?12:kind==='access'?10:5;
   if(kind==='meeting')state.temp=27.4-Math.min(1,elapsed/12)*2.6;
   if(kind==='access'){state.accessStep=elapsed<1.5?1:elapsed<3?2:elapsed<8?3:4;state.barrierAngle=elapsed<3?0:elapsed<5?(elapsed-3)/2*Math.PI/2:elapsed<7?Math.PI/2:elapsed<9?(9-elapsed)/2*Math.PI/2:0;}
   if(kind==='access'&&reduced.matches)state.barrierAngle=elapsed>=3&&elapsed<8?Math.PI/2:0;
   if(!reduced.matches&&time-lastVisual>=50){effects.animate(elapsed);effects.update({...state,climate:actual().climate});lastVisual=time;}
   if(Math.floor(elapsed*2)!==lastTick){lastTick=Math.floor(elapsed*2);render();}
   if(elapsed<limit)scenarioFrame=requestAnimationFrame(tick);else{scenarioFrame=0;state.scenario=null;render();}
  }scenarioFrame=requestAnimationFrame(tick);
 }
 async function startTour(){
  if(insights?.isReplaying())insights.returnCurrent();
  if(touring){stopTour();cancelFlight();stopScenario();render();return;}
  const generation=++tourGeneration;touring=true;play.innerHTML=icon('pause')+'<span>หยุดพาชม</span>';
  let step=0;async function next(){if(!touring||disposed||generation!==tourGeneration)return;const id=order[step];$('#tour-progress').textContent=`กำลังพาชม ${step+1} / ${order.length} · ${destinations[id].panel}`;const arrived=await select(id,{guided:true});if(!arrived||!touring||generation!==tourGeneration)return;
   const advance=()=>{if(generation!==tourGeneration)return;if(step<order.length)void next();else{stopTour('พาชมครบแล้ว · เลือกสำรวจต่อได้ทุกจุด');stopScenario();render();if(kiosk)tourTimer=setTimeout(()=>{if(kiosk&&!touring)restartLoop();},2500);}};
   // The car park stop plays the whole parking story, then the tour carries on.
   if(id==='parking'&&parking){await parking.playStory({auto:true});if(!touring||generation!==tourGeneration)return;step++;tourTimer=setTimeout(advance,1200);return;}
   if(id!=='overview')scenario(id);step++;tourTimer=setTimeout(advance,id==='meeting'?14000:11000);}void next();
 }
 listen(content,'click',event=>{if(insights?.isReplaying())return;const control=event.target.closest('[data-control]'),action=event.target.closest('[data-action]');if(control||(action&&action.dataset.action!=='tour'))stopTour('กำลังทดลองด้วยตัวเอง');if(control){stopScenario();const s=actual(),key=control.dataset.control;simulation.selectRoom(meetingId);if(key==='door')simulation.setRoom(meetingId,{doors:Object.fromEntries(Object.entries(s.doors).map(([id,value])=>[id,!value]))});else simulation.setRoom(meetingId,{[key]:!s[key]});render();}if(action){if(action.dataset.action==='tour')void startTour();else scenario(action.dataset.action);}});
 document.querySelectorAll('[data-destination]').forEach(b=>{b.disabled=false;listen(b,'click',()=>void select(b.dataset.destination));});
 for(const id of ['#tour-play','#tour-reset','#tour-night'])$(id).disabled=false;
 listen(play,'click',()=>void startTour());listen($('#tour-reset'),'click',()=>{insights?.returnCurrent({restore:false});stopTour();stopScenario();state=initial();simulation.reset();simulation.setNight(false);simulation.setRoom(meetingId,{climate:true});void select('overview');});
 listen($('#tour-night'),'click',()=>simulation.setNight(!simulation.getState().night));
 let daylightSolar=state.solar;
 const unsubscribe=simulation.subscribe(()=>{cameraImage='';if(!insights?.isReplaying()){if(simulation.getState().night){if(state.solar>0)daylightSolar=state.solar;state.solar=0;}else if(state.solar===0)state.solar=daylightSolar;}render();});
 simulation.setInteractionFilter(room=>!traveling&&!insights?.isReplaying()&&destination==='meeting'&&room.id===meetingId);
 listen(document,'visibilitychange',()=>{if(document.hidden){insights?.pause();stopTour('พักการพาชมเมื่อออกจากหน้านี้');stopScenario();cancelFlight();render();}});
 onUserOrbit(()=>{insights?.pause();stopTour('กำลังสำรวจด้วยตัวเอง');cancelFlight();});
 insights=createBuildingInsights({model,simulation,schedule,read:()=>state,write:value=>{state=structuredClone(value);},render,navigate:id=>select(id,{guided:true}),stopActivity:()=>{stopTour('กำลังสำรวจข้อมูลจำลอง');stopScenario();cancelFlight();}});
 simulation.setRoom(meetingId,{climate:true});
 // Showcase loop for an unattended screen: the tour repeats; any touch hands control to the visitor,
 // and the loop comes back after a quiet minute.
 const kioskToggle=$('#kiosk-toggle');let kiosk=false,idleTimer=0;const IDLE_MS=60000;
 function restartLoop(){if(disposed||!kiosk)return;insights?.returnCurrent({restore:false});stopScenario();state=initial();simulation.reset();simulation.setNight(false);simulation.setRoom(meetingId,{climate:true});void startTour();}
 function armIdle(){clearTimeout(idleTimer);if(kiosk)idleTimer=setTimeout(()=>{if(kiosk&&!touring&&!parking?.story.running)restartLoop();else armIdle();},IDLE_MS);}
 function setKiosk(on){kiosk=on;kioskToggle.checked=on;document.body.classList.toggle('kiosk-on',on);if(on){if(!touring)restartLoop();}else{clearTimeout(idleTimer);if(touring)stopTour();}}
 listen(kioskToggle,'change',()=>setKiosk(kioskToggle.checked));
 for(const type of ['pointerdown','keydown','wheel'])listen(document,type,event=>{if(!kiosk||event.target.closest?.('.kiosk-toggle'))return;if(touring){stopTour(getLang()==='en'?'Paused the showcase loop · explore freely':'หยุดโหมดจัดแสดงชั่วคราว · ทดลองได้เลย');cancelFlight();}armIdle();},{capture:true});
 // Parking UI activity counts as hands-on use, like the building controls.
 parking?.setInteractHandler(()=>{if(touring&&!kiosk)stopTour('กำลังทดลองด้วยตัวเอง');});
 function applyLanguage(){const en=getLang()==='en';$('#lang-toggle span').textContent=en?'TH':'EN';$('#kiosk-label').textContent=pt('story.kiosk');const dock=$('[data-destination="parking"] span');if(dock)dock.textContent=pt('parking.dock');if(destination==='parking'&&!traveling){$('#scene-heading').textContent=destinations.parking.title;$('#scene-description').textContent=destinations.parking.description;$('#scene-floor').textContent=destinations.parking.floor;}render();}
 listen($('#lang-toggle'),'click',()=>parking?.toggleLang());
 const offLang=onLang(applyLanguage);signal.addEventListener('abort',offLang,{once:true});applyLanguage();
 void select('overview',{instant:true});
 if(new URLSearchParams(location.search).get('kiosk')==='1')setTimeout(()=>setKiosk(true),600);
 else{const params=new URLSearchParams(location.search),dest=params.get('dest');if(dest&&destinations[dest])setTimeout(async()=>{const arrived=await select(dest);if(arrived&&dest==='parking'&&params.get('story')==='1')void parking?.playStory({auto:params.get('auto')!=='0'});},300);}
 return {dispose(){disposed=true;sequence++;insights?.dispose();stopTour();stopScenario();unsubscribe();simulation.setInteractionFilter(()=>true);abort.abort();effects.dispose();},getState(){return{insights:insights?.getState(),destination,traveling,pendingDestination,touring,scenario:state.scenario,...state};}};
}
