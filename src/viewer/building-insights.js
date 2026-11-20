import {daySnapshot,dayEvents,dayHistory,formatTime,incidentsFor} from 'osd/viewer/building-day.js';
import {createRoomLayers} from 'osd/viewer/room-layers.js';
const legends={none:'',temperature:'<i class="legend-cool"></i>ต่ำกว่า 25° <i class="legend-teal"></i>25–27° <i class="legend-warm"></i>27° ขึ้นไป',occupancy:'<i class="legend-teal"></i>มีคน <i class="legend-muted"></i>ห้องว่าง',lights:'<i class="legend-warm"></i>ไฟเปิด <i class="legend-muted"></i>ไฟปิด'};
export function createBuildingInsights({model,simulation,schedule,read,write,render,navigate,stopActivity}){
 const $=s=>document.querySelector(s),abort=new AbortController(),layers=createRoomLayers({model,rooms:simulation.rooms,schedule});
 const listen=(el,event,fn)=>el.addEventListener(event,fn,{signal:abort.signal});
 let replaying=false,playing=false,minute=810,layer='none',saved=null,generation=0,timer=0,disposed=false,lastContext=null;
 const events=$('#day-events'),incidentList=$('#incident-list'),range=$('#day-time');
 events.innerHTML=dayEvents.map((e,i)=>`<button data-day-event="${i}" title="${e.detail}"><time>${formatTime(e.minute)}</time><span>${e.title}</span></button>`).join('');
 function paint(){
  $('#replay-time').textContent=replaying?formatTime(minute):(simulation.getState().night?'22:00':'13:30');range.value=String(minute);range.setAttribute('aria-valuetext',`${formatTime(minute)} นาฬิกา · ข้อมูลจำลอง`);
  $('#replay-mode').textContent=replaying?(playing?'กำลังเล่าเรื่อง · จำลอง':'ย้อนหลัง · จำลอง'):'ทดลอง · จำลอง';
  $('#day-play').textContent=playing?'หยุดเล่าเรื่อง':'เล่นหนึ่งวันในอาคาร';$('#day-play').setAttribute('aria-pressed',String(playing));
  $('#day-current').hidden=!replaying;$('#replay-notice').hidden=!replaying;document.body.dataset.replaying=String(replaying);
  document.querySelectorAll('[data-layer]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layer===layer)));
  $('#layer-legend').innerHTML=legends[layer];$('#layer-legend').hidden=layer==='none';
  const current=dayEvents.findLastIndex(e=>e.minute<=minute);events.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-current',String(replaying&&i===current)));
 }
 function pause(){generation++;clearTimeout(timer);timer=0;playing=false;paint();}
 function enter(){if(!replaying){saved={telemetry:{...structuredClone(read()),scenario:null},simulation:simulation.getState()};replaying=true;}}
 function apply(time){enter();const snapshot=daySnapshot(time,simulation.rooms);minute=snapshot.minute;write(snapshot.telemetry);paint();simulation.applySnapshot(snapshot);}
 function setLayer(value){layer=value;paint();if(lastContext)update(lastContext);}
 function returnCurrent({restore=true}={}){
  pause();stopActivity();if(!replaying)return;const previous=saved;replaying=false;saved=null;minute=810;paint();
  if(restore&&previous){write(previous.telemetry);simulation.applySnapshot(previous.simulation);}else render();
 }
 async function visit(event){pause();enter();stopActivity();setLayer(event.layer);apply(event.minute);await navigate(event.destination);}
 async function playDay(){
  if(playing){pause();stopActivity();return;}
  pause();enter();stopActivity();playing=true;const ticket=generation;paint();
  async function step(index){
   if(disposed||ticket!==generation||!playing)return;const event=dayEvents[index],start=performance.now();setLayer(event.layer);apply(event.minute);
   const arrived=await navigate(event.destination);if(disposed||ticket!==generation||!playing)return;if(!arrived){pause();return;}
   const arrival=performance.now(),end=start+12000,following=dayEvents[index+1];
   function tick(){if(disposed||ticket!==generation||!playing)return;const now=performance.now();
    if(now>=end){if(following)void step(index+1);else{pause();render();}return;}
    if(following){const fraction=Math.min(1,(now-arrival)/Math.max(1,end-arrival));apply(event.minute+Math.floor((following.minute-event.minute)*fraction));}
    timer=setTimeout(tick,500);
   }timer=setTimeout(tick,500);
  }void step(0);
 }
 function update(context){
  lastContext=context;const {destination,traveling,state,sim}=context;paint();
  const roomData=state.roomData||daySnapshot(810,simulation.rooms).telemetry.roomData;
  // The meeting room also supports manual local experiments.
  const data={...roomData,'f4_meeting_2':{temp:state.temp,people:state.occupied?6:0}};
  const floor=destination==='meeting'?'4':destination==='pond'?'1':null;
  layers.update({layer,roomData:data,states:sim.rooms,floor,hidden:traveling||floor!==sim.view.currentFloor});
  const incidents=incidentsFor(state,sim.rooms);
  $('#incident-count').textContent=String(incidents.length);
  const html=incidents.length?incidents.map(i=>`<button class="incident-item" data-incident="${i.id}" data-target="${i.destination}" data-insight-layer="${i.layer}"><span class="incident-mark" aria-hidden="true">!</span><span><strong>${i.title}</strong><small>${i.detail}</small><small>${i.hint}</small></span><span aria-hidden="true">↗</span></button>`).join(''):'<p class="incident-clear"><span aria-hidden="true">✓</span> สถานะตัวอย่างอยู่ในช่วงปกติ</p>';
  if(incidentList.innerHTML!==html)incidentList.innerHTML=html;
  $('#insight-room').hidden=layer==='none'||destination!=='meeting';
  $('#insight-room').textContent=`ห้องประชุมย่อย 2 ชั้น 4 · ${layer==='temperature'?state.temp.toFixed(1)+' °C':layer==='occupancy'?(state.occupied?'มีคน 6 คน':'ไม่มีคน'):sim.rooms['f4_meeting_2'].light?'ไฟเปิด':'ไฟปิด'}`;
 }
 listen(range,'input',()=>{const time=Number(range.value);pause();enter();stopActivity();apply(time);});
 listen($('#day-play'),'click',()=>void playDay());listen($('#day-current'),'click',()=>returnCurrent());
 listen(events,'click',e=>{const button=e.target.closest('[data-day-event]');if(button)void visit(dayEvents[Number(button.dataset.dayEvent)]);});
 listen(incidentList,'click',e=>{const b=e.target.closest('[data-incident]');if(!b)return;pause();stopActivity();setLayer(b.dataset.insightLayer);void navigate(b.dataset.target);});
 document.querySelectorAll('[data-layer]').forEach(b=>{b.disabled=false;listen(b,'click',()=>{pause();stopActivity();setLayer(b.dataset.layer);if(layer!=='none'&&lastContext?.destination!=='meeting'&&lastContext?.destination!=='pond')void navigate('meeting');});});
 for(const selector of ['#day-play','#day-time'])$(selector).disabled=false;
 paint();
 return {update,pause,returnCurrent,isReplaying:()=>replaying,history:key=>replaying?dayHistory(minute,simulation.rooms,key):null,timeLabel:()=>replaying?`ข้อมูลจำลอง ณ เวลา ${formatTime(minute)}`:null,
  getState:()=>({replaying,playing,minute,layer}),
  dispose(){disposed=true;pause();abort.abort();layers.dispose();}
 };
}
