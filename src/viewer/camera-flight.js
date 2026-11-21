// Finite camera transitions. No scene, network or device dependencies.
// A step with `via` follows a curve bent towards that pose (a quadratic Bézier: it passes halfway between the
// straight line and `via`) instead of a straight line with a small lift.
const bend=(a,b,c,e)=>a.map((v,i)=>(1-e)*(1-e)*v+2*(1-e)*e*b[i]+e*e*c[i]);
function flightPose(from,to,progress,via){
 // Quadratic in-out: cubic spent its last quarter crawling, which read as 'arrived, now waiting'.
 const t=Math.max(0,Math.min(1,progress)),e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
 if(via)return {eye:bend(from.eye,via.eye,to.eye,e),target:bend(from.target,via.target,to.target,e),fov:bend([from.fov],[via.fov],[to.fov],e)[0]};
 const distance=Math.hypot(...to.eye.map((v,i)=>v-from.eye[i]));
 return {eye:from.eye.map((v,i)=>v+(to.eye[i]-v)*e+(i===1?Math.sin(Math.PI*e)*Math.min(distance*.18,8):0)),target:from.target.map((v,i)=>v+(to.target[i]-v)*e),fov:from.fov+(to.fov-from.fov)*e};
}
export function createCameraFlight({read,write,request=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id),now=()=>performance.now(),reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches,onState=()=>{}}){
 let handle=0,resolveCurrent;
 function stop(){if(handle)cancel(handle);handle=0;if(resolveCurrent){resolveCurrent(false);resolveCurrent=null;onState(false);}}
 function flyPath(steps){
  stop();if(!steps.length)return Promise.resolve(true);
  if(reduced()||steps.every(s=>s.duration===0)){for(const s of steps){s.onStart?.();write(s.to);s.onUpdate?.(1);s.onEnd?.();}return Promise.resolve(true);}
  let index=0,from=read(),start=now();onState(true);
  return new Promise(resolve=>{
   resolveCurrent=resolve;steps[0].onStart?.();
   function tick(time){
    while(index<steps.length){
     const s=steps[index],duration=s.duration??1800,t=duration?Math.min(1,(time-start)/duration):1;
     write(t===1?s.to:flightPose(from,s.to,t,s.via));s.onUpdate?.(t);
     if(t<1){handle=request(tick);return;}
     s.onEnd?.();from=read();start+=duration;index++;
     if(index<steps.length)steps[index].onStart?.();
    }
    handle=0;resolveCurrent=null;onState(false);resolve(true);
   }
   handle=request(tick);
  });
 }
 return {fly:(to,duration=1800)=>flyPath([{to,duration}]),flyPath,stop,get running(){return Boolean(handle);}};
}
