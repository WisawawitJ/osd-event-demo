// Finite camera transitions. No scene, network or device dependencies.
// A step with `via` follows a curve bent towards that pose (a quadratic Bézier: it passes halfway between the
// straight line and `via`) instead of a straight line with a small lift.
const bend=(a,b,c,u)=>a.map((v,i)=>(1-u)*(1-u)*v+2*(1-u)*u*b[i]+u*u*c[i]);
// Where along the curve (its parameter u) the camera is once it has covered a share of the way. A Bézier's parameter
// does not run at an even pace (from the overview the camera crept, then rushed), so the camera's path is measured once
// and the easing applies to the distance covered. The aim point and the field of view keep in step with the camera:
// paced on their own, the view swung to and fro as one ran ahead of the other.
function measure(a,b,c){
 const STEPS=48,lengths=[0];let last=a;
 for(let i=1;i<=STEPS;i++){const point=bend(a,b,c,i/STEPS);lengths.push(lengths[i-1]+Math.hypot(...point.map((v,k)=>v-last[k])));last=point;}
 const total=lengths[STEPS];
 return share=>{if(!(total>1e-6))return share;const goal=share*total;let i=1;while(i<STEPS&&lengths[i]<goal)i++;const x=lengths[i-1],y=lengths[i];return (i-1+(y>x?(goal-x)/(y-x):0))/STEPS;};
}
function flightPose(from,to,progress,via,along){
 // Quadratic in-out: cubic spent its last quarter crawling, which read as 'arrived, now waiting'.
 const t=Math.max(0,Math.min(1,progress)),e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
 if(via){const u=along(e);return {eye:bend(from.eye,via.eye,to.eye,u),target:bend(from.target,via.target,to.target,u),fov:bend([from.fov],[via.fov],[to.fov],u)[0]};}
 const distance=Math.hypot(...to.eye.map((v,i)=>v-from.eye[i]));
 return {eye:from.eye.map((v,i)=>v+(to.eye[i]-v)*e+(i===1?Math.sin(Math.PI*e)*Math.min(distance*.18,8):0)),target:from.target.map((v,i)=>v+(to.target[i]-v)*e),fov:from.fov+(to.fov-from.fov)*e};
}
export function createCameraFlight({read,write,request=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id),reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches,onState=()=>{}}){
 let handle=0,resolveCurrent;
 function stop(){if(handle)cancel(handle);handle=0;if(resolveCurrent){resolveCurrent(false);resolveCurrent=null;onState(false);}}
 function flyPath(steps){
  stop();if(!steps.length)return Promise.resolve(true);
  if(reduced()||steps.every(s=>s.duration===0)){for(const s of steps){s.onStart?.();write(s.to);s.onUpdate?.(1);s.onEnd?.();}return Promise.resolve(true);}
  // The clock starts at the first frame drawn: the frame of the click can be long (a layout change, a resize), and
  // starting before it made the camera's first visible step a jump.
  let index=0,from=read(),start=null,along=null,measured=-1;onState(true);
  return new Promise(resolve=>{
   resolveCurrent=resolve;steps[0].onStart?.();
   function tick(time){
    if(start===null)start=time;
    while(index<steps.length){
     const s=steps[index],duration=s.duration??1800,t=duration?Math.min(1,(time-start)/duration):1;
     if(s.via&&measured!==index){along=measure(from.eye,s.via.eye,s.to.eye);measured=index;}
     write(t===1?s.to:flightPose(from,s.to,t,s.via,along));s.onUpdate?.(t);
     if(t<1){handle=request(tick);return;}
     s.onEnd?.();from=read();start+=duration;index++;
     if(index<steps.length)steps[index].onStart?.();
    }
    handle=0;resolveCurrent=null;onState(false);resolve(true);
   }
   handle=request(tick);
  });
 }
 return {flyPath,stop,get running(){return Boolean(handle);}};
}
