import {createBuildingInsights} from 'osd/viewer/building-insights.js';
import {createTourEffects} from 'osd/viewer/tour-effects.js';
import {t as pt, onLang, getLang} from 'osd/parking/i18n.js';
import {SPEED} from 'osd/parking/clock.js';
const icons={building:'M3 21V5h12v16M15 11h6v10M7 9h4M7 13h4M7 17h4',light:'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9Z',air:'M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h5',people:'M4 21v-3a5 5 0 0 1 10 0v3m3-9a4 4 0 0 1 4 4v5M12 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',water:'M12 3S6 10 6 14a6 6 0 0 0 12 0c0-4-6-11-6-11Z',solar:'m5 9-2 10h18L19 9ZM8 9l-1 10m9-10 1 10M4 14h16M12 19v3M12 2v3M5 3l2 2m12-2-2 2',door:'M5 21V3h14v18M9 21V5l8 2v14M13 13h.01',arrow:'M4 12h16m-5-5 5 5-5 5',play:'m8 5 11 7-11 7Z',pause:'M8 5v14M16 5v14',check:'m5 12 4 4L19 6'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.building}"/></svg>`;
// Thai (default) or English, picked when the text is drawn; applyLanguage() redraws on a switch.
const L=(th,en)=>getLang()==='en'?en:th;
// Each field is a getter, so a destination's texts follow the TH/EN switch.
const texts=fields=>Object.defineProperties({},Object.fromEntries(Object.entries(fields).map(([key,[th,en]])=>[key,{get:()=>L(th,en),enumerable:true}])));
const destinations={
 overview:texts({title:['ทุกระบบ\nในมุมมองเดียว','Every system\nin one view'],description:['สำรวจอาคาร OSD ผ่านข้อมูลที่เชื่อมถึงกัน','Explore the OSD building through connected data'],panel:['ภาพรวมอาคาร','Building overview'],floor:['ทั้งอาคาร','Whole building'],chip:['โมเดลอาคาร OSD · 5 ระดับ','OSD building model · 5 levels']}),
 meeting:texts({title:['พื้นที่ที่พร้อม\nสำหรับทุกไอเดีย','A space ready\nfor every idea'],description:['แสง อากาศ และการใช้ห้อง เชื่อมกันอย่างพอดี','Light, air and room use, working together'],panel:['ห้องประชุม','Meeting room'],floor:['ชั้น 4','Floor 4'],chip:['ห้องประชุมย่อย 2 ชั้น 4 · แตะไฟ แอร์ หรือประตูเพื่อทดลอง','Meeting room 2, floor 4 · tap a light, the AC or a door to try it']}),
 pond:texts({title:['รายละเอียดเล็ก ๆ\nที่ดูแลได้ตลอด','Small details,\nalways cared for'],description:['มองเห็นความเปลี่ยนแปลงของน้ำ ก่อนเป็นปัญหา','Spot changes in the water before they become a problem'],panel:['บ่อปลาและสวน','Fish pond and garden'],floor:['ชั้น 1','Floor 1'],chip:['บ่อปลาริมห้องประชุม · เซ็นเซอร์จำลอง','Fish pond by the meeting room · simulated sensors']}),
 energy:texts({title:['พลังงานจากหลังคา\nสู่ทั้งอาคาร','Power from the roof\nfor the whole building'],description:['เห็นการผลิตและการใช้ไฟในภาพเดียว','See power production and use in one picture'],panel:['พลังงานอาคาร','Building energy'],floor:['ดาดฟ้า','Rooftop'],chip:['24 แผง · กำลังผลิตเป็นค่าจำลอง','24 panels · simulated output']}),
 access:texts({title:['ทุกการเข้าออก\nมีเรื่องราว','Every entry\ntells a story'],description:['เชื่อมภาพ เหตุการณ์ และสถานะทางเข้า','Camera images, events and gate status, linked'],panel:['ทางเข้าที่จอดรถ','Car park entrance'],floor:['ชั้น 1','Floor 1'],chip:['ไม้กั้นริมขอบพื้นที่ · ช่องทางเข้าออกตามลูกศร','Barrier at the site edge · lanes follow the arrows']}),
 // Parking access demo (src/parking): its texts follow the TH/EN switch.
 parking:{get title(){return pt('parking.title')},get description(){return pt('parking.description')},get panel(){return pt('parking.panel')},get floor(){return pt('parking.floor')},get chip(){return pt('parking.chip')}}
};
// Text in the static markup (src/pages/showcase.html), as [th,en] or a parking i18n lookup.
// data-i18n fills the text, data-i18n-label the aria-label, data-i18n-title the title.
// data-i18n-init marks text the showcase redraws itself; it is only filled in before the showcase starts.
const pageText={
 brand:['อาคารที่เชื่อมถึงกัน','Connected building'],demo:()=>pt('sim.data'),explore:['สำรวจอาคาร','Explore'],
 'night.title':['สลับกลางวันและกลางคืน','Switch between day and night'],night:['กลางคืน','Night'],
 toolbar:['ข้อมูลบนโมเดล','Data on the model'],'layer.heading':['สีพื้นห้อง','Room colours'],'layer.group':['เลือกข้อมูลแสดงด้วยสี','Choose the data shown as colour'],
 'layer.none':['ปกติ','Plain'],'layer.temperature':['อุณหภูมิ','Temperature'],'layer.occupancy':['การใช้ห้อง','Occupancy'],'layer.lights':['ไฟ','Lights'],
 viewport:['โมเดลอาคาร OSD แบบโต้ตอบ','Interactive OSD building model'],
 canvas:['โมเดลอาคาร OSD ลากเพื่อหมุน ใช้ปุ่มลูกศรเพื่อเลื่อน ปุ่มบวกหรือลบเพื่อซูม และ R เพื่อคืนมุมมอง','OSD building model. Drag to rotate, use the arrow keys to pan, plus or minus to zoom, and R to reset the view'],
 'scene.heading':['ทุกระบบ\nในมุมมองเดียว','Every system\nin one view'],'scene.description':['สำรวจอาคาร OSD ผ่านข้อมูลที่เชื่อมถึงกัน','Explore the OSD building through connected data'],
 'scene.floor':['ทั้งอาคาร','Whole building'],'scene.chip':['โมเดลอาคาร OSD · 5 ระดับ','OSD building model · 5 levels'],
 orbit:['ลากเพื่อหมุน · เลื่อนเพื่อซูม','Drag to rotate · scroll to zoom'],loading:['กำลังเตรียมอาคาร…','Preparing the building…'],retry:['ลองโหลดใหม่','Reload'],
 dock:['เลือกจุดพาชม','Choose a tour stop'],'dock.overview':['ภาพรวม','Overview'],'dock.meeting':['ห้องประชุม','Meeting room'],'dock.pond':['บ่อปลา','Fish pond'],'dock.energy':['พลังงาน','Energy'],'dock.access':['ทางเข้า','Entrance'],
 timeline:['สำรวจหนึ่งวันในอาคารด้วยข้อมูลจำลอง','Explore a day in the building with simulated data'],'day.mode':['ทดลอง · จำลอง','Hands-on · simulated'],
 'day.current':['กลับโหมดทดลอง','Back to hands-on'],'day.play':['เล่นหนึ่งวันในอาคาร','Play a day in the building'],'day.time':['เวลาในเรื่องราวจำลอง','Time in the simulated story'],'day.events':['ช่วงเวลาที่น่าสนใจ','Moments worth a look'],
 panel:['ข้อมูลประกอบจุดที่เลือก','Details for the selected spot'],'panel.title':['ภาพรวมอาคาร','Building overview'],'panel.status':['พร้อมพาชม','Ready to tour'],
 incidents:['จุดที่ควรดู','Worth a look'],'incidents.loading':['กำลังเตรียมเหตุการณ์…','Preparing events…'],
 'replay.notice':['กำลังดูย้อนหลัง · กลับโหมดทดลองเพื่อปรับอุปกรณ์','Viewing a replay · go back to hands-on to adjust devices'],'panel.loading':['กำลังเตรียมข้อมูลจำลอง…','Preparing simulated data…'],
 'view.group':['ควบคุมมุมมอง','View controls'],'view.zoomIn':['ซูมเข้า','Zoom in'],'view.zoomOut':['ซูมออก','Zoom out'],'view.reset':['มุมเริ่มต้น','Reset view'],'view.orbit':['หมุนเมื่อว่าง','Idle orbit'],'view.orbit.title':['หมุนมุมกล้องช้า ๆ เมื่อไม่มีการใช้งาน','Slowly circle the view when nobody is using it'],
 'tour.play':['เริ่มพาชม','Start tour'],'tour.reset':['เริ่มใหม่','Start over'],'tour.progress':['เลือกจุดที่สนใจ หรือให้เราพาชม','Pick a spot, or let us show you around'],
 kiosk:()=>pt('story.kiosk'),disclosure:()=>pt('sim.disclosure')
};
export const pageString=key=>{const text=pageText[key];return typeof text==='function'?text():L(...text);};
export function translatePage({initial=false}={}){
 for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=pageString(el.dataset.i18n);
 for(const el of document.querySelectorAll('[data-i18n-label]'))el.setAttribute('aria-label',pageString(el.dataset.i18nLabel));
 for(const el of document.querySelectorAll('[data-i18n-title]'))el.title=pageString(el.dataset.i18nTitle);
 if(initial)for(const el of document.querySelectorAll('[data-i18n-init]'))el.textContent=pageString(el.dataset.i18nInit);
}
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
 function chart(values,labels=['08:00','10:00','12:00','14:00'],unit='',historyKey=null){const history=historyKey&&insights?.history(historyKey);if(history){values=history.values;labels=history.labels;}const min=Math.min(...values)-1,max=Math.max(...values)+1;const points=values.map((v,i)=>[i*280/(values.length-1),74-(v-min)/(max-min)*60]);return `<svg class="chart" viewBox="0 0 280 100" role="img" aria-label="${L('กราฟตัวอย่าง','Sample chart:')} ${unit}"><path class="chart-grid" d="M0 18h280M0 46h280M0 74h280"/><path d="M${points.map(p=>p.join(',')).join(' L')} L280,82 L0,82Z" fill="#e9effd" stroke="none"/><path class="chart-line" d="M${points.map(p=>p.join(',')).join(' L')}"/>${labels.map((l,i)=>`<text x="${i*280/(labels.length-1)}" y="98" text-anchor="${i===0?'start':i===labels.length-1?'end':'middle'}">${l}</text>`).join('')}</svg>`;}
 function events(items){return items.map(([time,text])=>`<div class="event-row"><time>${time}</time><p>${text}</p></div>`).join('');}
 function controls(){const s=actual(),door=Object.values(s.doors).some(Boolean);return `<div class="local-controls"><button data-control="light" aria-pressed="${s.light}">${icon('light')}${L(`ไฟ ${s.light?'เปิด':'ปิด'}`,`Light ${s.light?'on':'off'}`)}</button><button data-control="climate" aria-pressed="${s.climate}">${icon('air')}${L(`แอร์ ${s.climate?'เปิด':'ปิด'}`,`AC ${s.climate?'on':'off'}`)}</button><button data-control="door" aria-pressed="${door}">${icon('door')}${L(`ประตู ${door?'เปิด':'ปิด'}`,`Door ${door?'open':'closed'}`)}</button></div>`;}
 function render(){
  if(disposed)return;const s=actual(),sim=simulation.getState(),d=destinations[destination];
  const focused=document.activeElement?.dataset?.control||document.activeElement?.dataset?.action;
  const lights=Object.values(sim.rooms).filter(r=>r.light).length,ac=Object.values(sim.rooms).filter(r=>r.climate).length;
  effects.update({...state,climate:s.climate,light:s.light});
  if(destination==='access'&&!traveling&&(!cameraImage||performance.now()-lastPreview>=400)){cameraImage=snapshot(effects.securityCamera);lastPreview=performance.now();}
  $('#panel-title').textContent=d.panel;
  $('#panel-status').textContent=destination==='pond'&&state.pondAlert?L('ควรตรวจสอบ','Check needed'):destination==='meeting'?(state.occupied?L('มีคนใช้งาน','In use'):L('ห้องว่าง','Vacant')):destination==='access'?L(...[['พร้อมสาธิต','Ready to demo'],['อ่านทะเบียนแล้ว','Plate read'],['อนุญาตผ่าน','Access granted'],['ไม้กั้นเปิด','Barrier open'],['ผ่านเรียบร้อย','Car through']][state.accessStep]):L('ข้อมูลจำลอง','Simulated data');
  if(destination==='parking')$('#panel-status').textContent=pt('sim.data');
  $('#panel-status').classList.toggle('attention',destination==='pond'&&state.pondAlert);
  if(destination==='overview')content.innerHTML=`<p class="dashboard-intro">${L('มองเห็นสิ่งที่เกิดขึ้นในอาคาร แล้วไปยังจุดที่ต้องการได้ทันที','See what is happening in the building, then go straight to any spot')}</p><div class="metric-pair">${metric(L('พลังงานจากโซลาร์','Solar power'),state.solar.toFixed(1),'kW',insights?.timeLabel()||(sim.night?L('ข้อมูลตัวอย่าง ณ เวลา 22:00','Sample data at 22:00'):L('ข้อมูลตัวอย่าง ณ เวลา 13:30','Sample data at 13:30')))}${metric(L('ห้องประชุมตัวอย่าง','Sample meeting room'),state.occupied?L('ใช้งาน','In use'):L('ว่าง','Free'),'',L('สถานะจาก radar จำลอง','From simulated radar'))}</div><div class="dashboard-section"><h3>${L('ระบบในอาคาร','Building systems')}</h3>${system('light',L('แสงสว่าง','Lighting'),L('วงจรไฟในโมเดล','Light circuits in the model'),L(`${lights} เปิด`,`${lights} on`))}${system('air',L('เครื่องปรับอากาศ','Air conditioning'),L('สถานะในตัวจำลอง','Simulated status'),L(`${ac} เปิด`,`${ac} on`))}${system('water',L('บ่อปลา','Fish pond'),state.pondAlert?L('ระดับน้ำต่ำกว่าค่าที่ตั้ง','Water below the set level'):L('ระดับน้ำอยู่ในช่วงที่ตั้ง','Water within the set range'),state.water+'%')}</div><div class="dashboard-section"><h3>${L('จุดที่น่าสนใจ','Places to visit')}</h3>${events(getLang()==='en'?[['Meeting room','Tap the meeting room to try the lights and AC'],['Rooftop','Follow the energy path from the solar panels'],['Entrance','Play the plate and barrier event']]:[['ห้องประชุม','แตะห้องประชุมเพื่อทดลองไฟและแอร์'],['ดาดฟ้า','ดูเส้นทางพลังงานจากแผงโซลาร์'],['ทางเข้า','เล่นเหตุการณ์ทะเบียนและไม้กั้น']])}</div><button class="panel-action" data-action="tour">${icon('play')}${L('พาชมทุกระบบ','Tour every system')}</button>`;
  if(destination==='meeting')content.innerHTML=`<p class="dashboard-intro">${L('ห้องประชุมย่อย 2 ชั้น 4 · แสงและอากาศที่ปรับให้เข้ากับการใช้งาน','Meeting room 2, floor 4 · light and air tuned to how the room is used')}</p><div class="metric-pair">${metric(L('อุณหภูมิห้อง','Room temperature'),state.temp.toFixed(1),'°C')}${metric(L('ตั้งอุณหภูมิ','Set point'),state.target,'°C')}</div><div class="dashboard-section">${row(L('การใช้งาน','Occupancy'),state.occupied?L('มีคนอยู่ · 6 คนจำลอง','Occupied · 6 simulated people'):L('ไม่มีคน','Empty'))}${row(L('แอร์','AC'),s.climate?L('เปิดโหมดเย็น','Cooling'):L('ปิด','Off'))}${row(L('ประตู','Door'),Object.values(s.doors).some(Boolean)?L('เปิด','Open'):L('ปิด','Closed'))}</div>${controls()}<div class="dashboard-section"><h3>${L('แนวโน้มอุณหภูมิ · ตัวอย่าง','Temperature trend · sample')}</h3>${chart([27.5,27.2,26.8,26.2,25.9,state.temp],getLang()==='en'?['Start','5 min','10 min','Now']:['เริ่ม','5 นาที','10 นาที','ตอนนี้'],L('อุณหภูมิ','temperature'),'temp')}<div class="chart-caption"><span>${insights?.timeLabel()||L('อุณหภูมิห้อง','Room temperature')}</span><span>${L('เป้าหมาย','Target')} ${state.target} °C</span></div></div><button class="panel-action" data-action="meeting">${icon('play')}${L('จำลองเริ่มประชุม','Simulate a meeting')}</button><p class="scenario-note">${state.scenario==='meeting'?L('กำลังจำลองการทำความเย็น · เร่งเวลาเพื่อสาธิต','Simulating cooling · time sped up for the demo'):L('จุดสีเขียวเป็นตำแหน่งคนสมมติ ไม่ใช่ผลติดตามบุคคลจริง','Green dots are made-up positions, not real people tracking')}</p>`;
  if(destination==='pond')content.innerHTML=`<p class="dashboard-intro">${L('ข้อมูลน้ำและสภาพแวดล้อมของบ่อปลาริมห้องประชุม','Water and surroundings of the fish pond by the meeting room')}</p><div class="metric-pair">${metric(L('ระดับน้ำ','Water level'),state.water,'%')}${metric(L('อุณหภูมิน้ำ','Water temperature'),'27.1','°C')}</div><div class="water-level ${state.pondAlert?'warning':''}" aria-label="${L('ระดับน้ำ','Water level')} ${state.water}%">${Array.from({length:12},(_,i)=>`<i class="${i<Math.round(state.water/100*12)?'filled':''}"></i>`).join('')}</div>${state.pondAlert?`<div class="alert-strip">${L('ระดับน้ำต่ำ · ตรวจสอบบ่อและระบบเติมน้ำ<br>เหตุการณ์จำลอง ไม่ได้สั่งปั๊มน้ำ','Low water · check the pond and the refill system<br>Simulated event, no pump was switched')}</div>`:''}<div class="dashboard-section">${row(L('ความเป็นกรด–ด่าง','Acidity'),'pH 7.2')}${row(L('ออกซิเจนละลายน้ำ','Dissolved oxygen'),'6.4 mg/L')}${row(L('สถานะปั๊มจำลอง','Simulated pump'),L('ทำงาน','Running'))}${row(L('เกณฑ์ระดับน้ำในเดโม','Demo water threshold'),L('เตือนเมื่อ < 65%','Alert below 65%'))}</div><div class="dashboard-section"><h3>${L('ระดับน้ำ · ตัวอย่างวันนี้','Water level · sample day')}</h3>${chart([81,83,82,81,82,state.water],['08:00','10:00','12:00','13:30'],L('ระดับน้ำ','water level'),'water')}</div><button class="panel-action" data-action="pond">${icon(state.pondAlert?'check':'water')}${state.pondAlert?L('คืนค่าระดับน้ำ','Restore water level'):L('จำลองระดับน้ำต่ำ','Simulate low water')}</button><p class="scenario-note">${L('ค่าคุณภาพน้ำและเกณฑ์แจ้งเตือนเป็นตัวอย่างสำหรับเดโม','Water quality values and alert thresholds are demo examples')}</p>`;
  if(destination==='energy')content.innerHTML=`<p class="dashboard-intro">${L('แผงโซลาร์ 24 แผง · เห็นแหล่งที่มาของพลังงานอาคาร','24 solar panels · see where the building gets its power')}</p><div class="metric-pair">${metric(L('ผลิตอยู่ตอนนี้','Producing now'),state.solar.toFixed(1),'kW')}${metric(L('ผลิตสะสมวันนี้','Produced today'),state.energy.toFixed(1),'kWh')}</div><div class="energy-flow"><div class="energy-node">${icon('solar')}<strong>${state.solar.toFixed(1)} kW</strong><span>${L('โซลาร์','Solar')}</span></div><span class="flow-arrow">${icon('arrow')}</span><div class="energy-node">${icon('building')}<strong>${state.load.toFixed(1)} kW</strong><span>${L('อาคาร','Building')}</span></div></div>${row(L('รับไฟจากกริด','From the grid'),(state.load-state.solar).toFixed(1)+' kW')}${row(L('สัดส่วนไฟจากโซลาร์','Solar share'),Math.round(state.solar/state.load*100)+'%')}<div class="dashboard-section"><h3>${L('กำลังผลิต · ตัวอย่างวันนี้','Output · sample day')}</h3>${chart([0,.4,2.3,5.1,7.4,9.1,state.solar,7.7,5.8,2.4,0],['06:00','10:00','14:00','18:00'],L('กำลังผลิตโซลาร์','solar output'),'solar')}<div class="chart-caption"><span>${insights?.timeLabel()||'Solar production'}</span><span>kW</span></div></div><button class="panel-action" data-action="energy">${icon('solar')}${state.solar<5?L('จำลองแดดกลับมา','Simulate the sun returning'):L('จำลองเมฆบังแผง','Simulate clouds over the panels')}</button><p class="scenario-note">${L('ตัวเลขเป็นตัวอย่าง ไม่ใช่กำลังผลิตที่คำนวณจากสเปกแผงจริง','Sample figures, not output calculated from real panel specs')}</p>`;
  if(destination==='access')content.innerHTML=`<div class="camera-preview">${cameraImage?`<img src="${cameraImage}" alt="${L('ภาพจำลองจากจุดติดตั้งกล้องไม้กั้น','Simulated view from the barrier camera position')}">`:''}<span>${L('มุมกล้องทางรถเข้า · ภาพจำลอง','Entrance camera view · simulated')}</span></div><div class="plate">กข 1234<small>${L('ทะเบียนตัวอย่าง · กรุงเทพมหานคร','Sample plate · Bangkok')}</small></div><div class="dashboard-section">${row(L('ผลอ่านทะเบียน','Plate reading'),state.accessStep?L('พบทะเบียนตัวอย่าง','Sample plate found'):L('รอเหตุการณ์','Waiting for a car'))}${row(L('สิทธิ์เข้าอาคาร','Building access'),state.accessStep>=2?L('อนุญาต · รายการจำลอง','Allowed · simulated list'):L('ยังไม่ตรวจสอบ','Not checked yet'))}${row(L('ไม้กั้น','Barrier'),state.barrierAngle>.1?L('เปิด / กำลังเคลื่อน','Open / moving'):L('ปิด','Closed'))}${row('Face recognition',L('ผู้มาติดต่อ A · ตัวอย่าง','Visitor A · sample'))}</div><div class="dashboard-section"><h3>${L('ลำดับเหตุการณ์จำลอง','Simulated event log')}</h3>${events(insights?.isReplaying()?(state.accessStep===0?[['08:00',L('ยังไม่มีรถผ่านทางเข้า','No cars through the entrance yet')]]:[['08:15',L('อ่านทะเบียน กข 1234 และอนุญาตผ่าน','Plate กข 1234 read and allowed in')],...(state.accessStep>=4?[['08:20',L('ปิดไม้กั้นหลังรถผ่าน','Barrier closed after the car passed')]]:[])]):state.accessStep===0?[[L('พร้อมสาธิต','Ready to demo'),L('กดปุ่มเพื่อเล่นเหตุการณ์รถเข้า','Press the button to play a car arriving')]]:[['13:30:02',L('อ่านทะเบียน กข 1234','Plate กข 1234 read')],...(state.accessStep>=2?[['13:30:03',L('ตรวจสิทธิ์ผ่าน','Access check passed')]]:[]),...(state.accessStep>=3?[['13:30:04',L('ไม้กั้นเปิดให้รถผ่าน','Barrier opened for the car')]]:[]),...(state.accessStep>=4?[['13:30:09',L('ปิดไม้กั้นหลังรถผ่าน','Barrier closed after the car passed')]]:[])])}</div><button class="panel-action" data-action="access">${icon('play')}${L('จำลองรถผ่านทางเข้า','Simulate a car entering')}</button><p class="scenario-note">${L('ไม่มีการวิเคราะห์ใบหน้าหรือทะเบียนจริงในเดโมนี้','No real face or plate analysis happens in this demo')}</p>`;
  const action=content.querySelector('.panel-action'),section=content.querySelector('.dashboard-section');if(destination!=='overview'&&action&&section)content.insertBefore(action,section);
  if(focused)content.querySelector(`[data-control="${focused}"],[data-action="${focused}"]`)?.focus({preventScroll:true});
  $('#tour-night').setAttribute('aria-pressed',String(sim.night));
  $('#tour-night span').textContent=sim.night?L('กลางวัน','Day'):L('กลางคืน','Night');
  const replaying=insights?.isReplaying()||false;content.querySelectorAll('[data-control],[data-action]').forEach(b=>b.disabled=replaying);
  content.inert=traveling;content.setAttribute('aria-busy',String(traveling));$('#tour-night').disabled=traveling||replaying;
  if(traveling)$('#panel-status').textContent=L('กำลังเดินทาง','On the way');
  if(!traveling)$('#scene-chip').textContent=replaying?`${d.floor} · ${d.panel} · ${insights.timeLabel()}`:d.chip;
  insights?.update({destination,traveling,state,sim});
 }
 function stopScenario(){cancelAnimationFrame(scenarioFrame);scenarioFrame=0;if(state.scenario==='access'){state.barrierAngle=0;state.accessStep=0;}state.scenario=null;}
 // The footer message is kept as [th,en] (or a function) so a language switch can redraw it.
 let progress=['เลือกจุดที่สนใจ หรือให้เราพาชม','Pick a spot, or let us show you around'];
 function setProgress(message){progress=message;$('#tour-progress').textContent=typeof message==='function'?message():L(...message);}
 const playLabel=()=>touring?L('หยุดพาชม','Stop tour'):L('เริ่มพาชม','Start tour');
 function stopTour(message=['หยุดพาชมแล้ว · เลือกจุดต่อไปได้เอง','Tour stopped · pick the next spot yourself']){if(touring)parking?.stopStory();tourGeneration++;clearTimeout(tourTimer);tourTimer=0;touring=false;play.innerHTML=icon('play')+`<span>${playLabel()}</span>`;setProgress(message);}
 async function select(id,{guided=false,instant=false}={}){
  if(!destinations[id]||disposed)return false;if(!guided){insights?.pause();stopTour(['เลือกจุดที่สนใจ หรือให้เราพาชม','Pick a spot, or let us show you around']);}stopScenario();const ticket=++sequence,d=destinations[id];
  if(destination==='parking'&&id!=='parking')parking?.exit();
  // The car park changes the page layout: switch it before the flight, so the view is its final size while the
  // camera moves instead of jumping at the end.
  if(id==='parking'&&!parking?.active)parking?.enter();
  traveling=true;pendingDestination=id;effects.select(null);render();
  document.querySelectorAll('[data-destination]').forEach(b=>{b.setAttribute('aria-busy',String(b.dataset.destination===id));b.setAttribute('aria-pressed',String(b.dataset.destination===id));});
  // The stop's title, panel and scene state arrive as the final approach begins, not after the camera settles.
  let committed=false;
  const commit=()=>{
   if(committed||disposed||ticket!==sequence)return;committed=true;
   destination=id;document.body.dataset.tourDestination=id;$('#scene-heading').textContent=d.title;$('#scene-description').textContent=d.description;$('#scene-floor').textContent=d.floor;$('#scene-chip').textContent=d.chip;
   effects.select(id);if(id==='access')cameraImage='';
   // The meeting stop's controls act on its room: select it on arrival, so night lighting is laid out around it
   // from the start and its switch only changes that room.
   if(id==='meeting')simulation.selectRoom(meetingId);
   render();
  };
  const arrived=await navigate(id,{instant,onApproach:commit,onPhase(phase){if(ticket===sequence){$('#scene-chip').textContent=`${phase} → ${d.floor} · ${d.panel}`;$('#flight-status').textContent=L(`กำลังไป ${d.floor} · ${d.panel}`,`Heading to ${d.floor} · ${d.panel}`);}}});
  if(disposed||ticket!==sequence)return false;
  traveling=false;pendingDestination=null;document.querySelectorAll('[data-destination]').forEach(b=>{b.removeAttribute('aria-busy');b.setAttribute('aria-pressed',String(b.dataset.destination===(arrived||committed?id:destination)));});
  if(!arrived&&!committed){
   $('#scene-chip').textContent=L('หยุดการบินแล้ว · หมุนสำรวจหรือเลือกจุดต่อไป','Flight stopped · orbit to explore or pick the next spot');effects.select(destination);
   if(destination==='parking'&&!parking?.active)parking?.enter();
   if(destination!=='parking'&&parking?.active)parking.exit();
   render();return false;
  }
  // The floor transition ends by restoring the visibility it captured when it began; re-apply this stop's effects.
  commit();effects.select(id);render();return true;
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
   if(!reduced.matches&&time-lastVisual>=50){effects.animate(elapsed);effects.update({...state,climate:actual().climate,light:actual().light});lastVisual=time;}
   if(Math.floor(elapsed*2)!==lastTick){lastTick=Math.floor(elapsed*2);render();}
   if(elapsed<limit)scenarioFrame=requestAnimationFrame(tick);else{scenarioFrame=0;state.scenario=null;render();}
  }scenarioFrame=requestAnimationFrame(tick);
 }
 async function startTour(){
  if(insights?.isReplaying())insights.returnCurrent();
  if(touring){stopTour();cancelFlight();stopScenario();render();return;}
  const generation=++tourGeneration;touring=true;play.innerHTML=icon('pause')+`<span>${playLabel()}</span>`;
  let step=0;async function next(){if(!touring||disposed||generation!==tourGeneration)return;const id=order[step];const at=step+1;setProgress(()=>L(`กำลังพาชม ${at} / ${order.length} · ${destinations[id].panel}`,`Touring ${at} / ${order.length} · ${destinations[id].panel}`));const arrived=await select(id,{guided:true});if(!arrived||!touring||generation!==tourGeneration)return;
   const advance=()=>{if(generation!==tourGeneration)return;if(step<order.length)void next();else{stopTour(['พาชมครบแล้ว · เลือกสำรวจต่อได้ทุกจุด','Tour complete · explore any spot you like']);stopScenario();render();if(kiosk)tourTimer=setTimeout(()=>{if(kiosk&&!touring)restartLoop();},2500);}};
   // The car park stop plays the whole parking story, then the tour carries on.
   if(id==='parking'&&parking){await parking.playStory({auto:true});if(!touring||generation!==tourGeneration)return;step++;tourTimer=setTimeout(advance,1200);return;}
   if(id!=='overview')scenario(id);step++;tourTimer=setTimeout(advance,(id==='meeting'?14000:11000)/SPEED);}void next();
 }
 listen(content,'click',event=>{if(insights?.isReplaying())return;const control=event.target.closest('[data-control]'),action=event.target.closest('[data-action]');if(control||(action&&action.dataset.action!=='tour'))stopTour(['กำลังทดลองด้วยตัวเอง','Trying it yourself']);if(control){stopScenario();const s=actual(),key=control.dataset.control;simulation.selectRoom(meetingId);if(key==='door')simulation.setRoom(meetingId,{doors:Object.fromEntries(Object.entries(s.doors).map(([id,value])=>[id,!value]))});else simulation.setRoom(meetingId,{[key]:!s[key]});render();}if(action){if(action.dataset.action==='tour')void startTour();else scenario(action.dataset.action);}});
 document.querySelectorAll('[data-destination]').forEach(b=>{b.disabled=false;listen(b,'click',()=>void select(b.dataset.destination));});
 for(const id of ['#tour-play','#tour-reset','#tour-night'])$(id).disabled=false;
 listen(play,'click',()=>void startTour());listen($('#tour-reset'),'click',()=>{insights?.returnCurrent({restore:false});stopTour();stopScenario();state=initial();simulation.reset();simulation.setNight(false);simulation.setRoom(meetingId,{climate:true});void select('overview');});
 listen($('#tour-night'),'click',()=>simulation.setNight(!simulation.getState().night));
 let daylightSolar=state.solar;
 const unsubscribe=simulation.subscribe(()=>{cameraImage='';if(!insights?.isReplaying()){if(simulation.getState().night){if(state.solar>0)daylightSolar=state.solar;state.solar=0;}else if(state.solar===0)state.solar=daylightSolar;}render();});
 simulation.setInteractionFilter(room=>!traveling&&!insights?.isReplaying()&&destination==='meeting'&&room.id===meetingId);
 listen(document,'visibilitychange',()=>{if(document.hidden){insights?.pause();stopTour(['พักการพาชมเมื่อออกจากหน้านี้','Tour paused while you were away']);stopScenario();cancelFlight();render();}});
 onUserOrbit(()=>{insights?.pause();stopTour(['กำลังสำรวจด้วยตัวเอง','Exploring on your own']);cancelFlight();});
 insights=createBuildingInsights({model,simulation,schedule,read:()=>state,write:value=>{state=structuredClone(value);},render,navigate:id=>select(id,{guided:true}),stopActivity:()=>{stopTour(['กำลังสำรวจข้อมูลจำลอง','Exploring simulated data']);stopScenario();cancelFlight();}});
 simulation.setRoom(meetingId,{climate:true});
 // Showcase loop for an unattended screen: the tour repeats; any touch hands control to the visitor,
 // and the loop comes back after a quiet minute.
 const kioskToggle=$('#kiosk-toggle');let kiosk=false,idleTimer=0;const IDLE_MS=60000/SPEED;
 function restartLoop(){if(disposed||!kiosk)return;insights?.returnCurrent({restore:false});stopScenario();state=initial();simulation.reset();simulation.setNight(false);simulation.setRoom(meetingId,{climate:true});void startTour();}
 // A parking story playing on auto-advance is left to finish; one waiting for Next or paused is abandoned like any idle screen.
 function armIdle(){clearTimeout(idleTimer);if(kiosk)idleTimer=setTimeout(()=>{const s=parking?.story,playing=s?.running&&s.auto&&!s.paused;if(kiosk&&!touring&&!playing){s?.stop();restartLoop();}else armIdle();},IDLE_MS);}
 function setKiosk(on){kiosk=on;kioskToggle.checked=on;document.body.classList.toggle('kiosk-on',on);if(on){if(!touring)restartLoop();}else{clearTimeout(idleTimer);if(touring)stopTour();}}
 listen(kioskToggle,'change',()=>setKiosk(kioskToggle.checked));
 for(const type of ['pointerdown','keydown','wheel'])listen(document,type,event=>{if(!kiosk||event.target.closest?.('.kiosk-toggle'))return;if(touring){stopTour(['หยุดโหมดจัดแสดงชั่วคราว · ทดลองได้เลย','Paused the showcase loop · explore freely']);cancelFlight();}armIdle();},{capture:true});
 // Parking UI activity counts as hands-on use, like the building controls.
 parking?.setInteractHandler(()=>{if(touring&&!kiosk)stopTour(['กำลังทดลองด้วยตัวเอง','Trying it yourself']);});
 // Runs on every TH/EN switch: static markup, then everything the showcase draws itself.
 function applyLanguage(){const en=getLang()==='en';$('#lang-toggle span').textContent=en?'TH':'EN';translatePage();$('#kiosk-label').textContent=pt('story.kiosk');const dock=$('[data-destination="parking"] span');if(dock)dock.textContent=pt('parking.dock');
  const d=destinations[destination];$('#scene-heading').textContent=d.title;$('#scene-description').textContent=d.description;$('#scene-floor').textContent=d.floor;
  const playText=play.querySelector('span');if(playText)playText.textContent=playLabel();setProgress(progress);insights?.relabel();render();}
 listen($('#lang-toggle'),'click',()=>parking?.toggleLang());
 const offLang=onLang(applyLanguage);signal.addEventListener('abort',offLang,{once:true});applyLanguage();
 void select('overview',{instant:true});
 if(new URLSearchParams(location.search).get('kiosk')==='1')setTimeout(()=>setKiosk(true),600);
 else{const params=new URLSearchParams(location.search),dest=params.get('dest');if(dest&&destinations[dest])setTimeout(async()=>{const arrived=await select(dest);if(arrived&&dest==='parking'&&params.get('story')==='1')void parking?.playStory({auto:params.get('auto')!=='0'});},300);}
 // Back to the current stop's own camera pose (the view controls and the R key use this).
 function resetView(){if(disposed||traveling)return;cancelFlight();void navigate(destination,{});}
 return {resetView,dispose(){disposed=true;sequence++;insights?.dispose();stopTour();stopScenario();unsubscribe();simulation.setInteractionFilter(()=>true);abort.abort();effects.dispose();},getState(){return{insights:insights?.getState(),destination,traveling,pendingDestination,touring,scenario:state.scenario,...state};}};
}
