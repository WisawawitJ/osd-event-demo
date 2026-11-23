import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {L} from 'osd/viewer/texts.js';
import {maxZoomOut} from 'osd/viewer/view-math.js';
import {stops} from 'osd/viewer/stops.js';

// The showcase's camera flights: to a stop (navigate), cut short (cancel), the car park story's own (fly), and the view
// buttons' short moves (move). `showStop(id)`: what the model shows at a stop.
export function createNavigation({
  scene,
  model,
  camera,
  controls,
  flight,
  readPose,
  writePose,
  sceneTransition,
  meetingRoom,
  parkingPose,
  showStop,
  schedule,
  signal,
}) {
  const meetingRoot = model.getObjectByName(`Floor_${meetingRoom.floor}`);
  const meetingTarget = meetingRoot.localToWorld(new THREE.Vector3(meetingRoom.center[0], 0.8, meetingRoom.center[2]));
  const buildingBounds = new THREE.Box3().setFromObject(model),
    buildingCenter = buildingBounds.getCenter(new THREE.Vector3());
  let ticketNow = 0,
    lastDestination = 'overview',
    stopPoses = null,
    docking = false;
  // The ring that marks the stop a flight is bound for.
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: '#27a8b3',
    transparent: true,
    opacity: 0.6,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  const marker = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.2, 48), markerMaterial);
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 100;
  marker.visible = false;
  scene.add(marker);
  signal.addEventListener(
    'abort',
    () => {
      marker.removeFromParent();
      marker.geometry.dispose();
      markerMaterial.dispose();
    },
    {once: true},
  );
  function contextPose(direction = new THREE.Vector3(0.72, 0.55, 1.6)) {
    direction = direction.clone().normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize(),
      up = new THREE.Vector3().crossVectors(direction, right).normalize(),
      fov = 38,
      tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    let distance = 1;
    for (const x of [buildingBounds.min.x, buildingBounds.max.x])
      for (const y of [buildingBounds.min.y, buildingBounds.max.y])
        for (const z of [buildingBounds.min.z, buildingBounds.max.z]) {
          const v = new THREE.Vector3(x, y, z).sub(buildingCenter);
          distance = Math.max(
            distance,
            v.dot(direction) + Math.abs(v.dot(right)) / (tan * camera.aspect),
            v.dot(direction) + Math.abs(v.dot(up)) / tan,
          );
        }
    return {
      eye: buildingCenter
        .clone()
        .addScaledVector(direction, distance * 1.13)
        .toArray(),
      target: buildingCenter.toArray(),
      fov,
    };
  }
  function applyDestination(id) {
    showStop(id);
    controls.minDistance = 0.4;
    // Zooming out stops a little past the whole-site view (at 500 m the world was a disc floating in the sky colour).
    const c = contextPose();
    controls.maxDistance = maxZoomOut(
      Math.hypot(c.eye[0] - c.target[0], c.eye[1] - c.target[1], c.eye[2] - c.target[2]),
    );
  }
  // A flight's floors settled at once on a stop's scene: one cut short (see cancelFlight), or taken over.
  function settle(id) {
    sceneTransition.finish();
    applyDestination(id);
    lastDestination = id;
  }
  // Camera poses aimed at the real objects: the pond and the roof's solar panels. The
  // original hard-coded targets sat 4–5 m off them; the viewing angles and distances are kept.
  function objectPoses() {
    if (stopPoses) return stopPoses;
    const ponds = [];
    model.traverse((o) => {
      if (o.isMesh && o.name.includes('_koi_pond_')) ponds.push(o);
    });
    const aim = (objects, eye, target, fov) => {
      const box = new THREE.Box3();
      for (const o of objects) if (o) box.expandByObject(o);
      if (box.isEmpty()) return {eye, target, fov};
      const centre = box.getCenter(new THREE.Vector3()),
        offset = new THREE.Vector3(...eye).sub(new THREE.Vector3(...target));
      return {eye: centre.clone().add(offset).toArray(), target: centre.toArray(), fov};
    };
    stopPoses = {
      pond: aim(ponds, [33, 14, 13], [22.7, 1, -2.5], 48),
      energy: aim([model.getObjectByName('Floor_5_solar_modules')], [12, 29, 23], [-1.6, 15.6, 0.8], 43),
    };
    return stopPoses;
  }

  // The view buttons' short move: `step(t)` each frame, t from 0 to 1 over `ms`. Any flight stops it: with reduced motion
  // a stop lands at once, and its leftover frames then moved the camera off it.
  let moveFrame = 0;
  function stopMove() {
    cancelAnimationFrame(moveFrame);
  }
  function move(step, ms = 260) {
    stopMove();
    const start = performance.now();
    const tick = (time) => {
      const t = Math.min(1, (time - start) / ms);
      step(t * (2 - t));
      controls.update();
      // At once: a zoom toward the cursor before the next frame worked from the view before the step.
      camera.updateMatrixWorld();
      schedule();
      if (t < 1) moveFrame = requestAnimationFrame(tick);
    };
    moveFrame = requestAnimationFrame(tick);
  }
  // The floors' change ends with the flight (left mid-cut, the building stayed half cut away where it stopped), on the
  // scene of the stop on show: the new one once its approach has begun, else the one the flight left.
  // A cancelled flight is no longer docking (a later parking-story camera move settled the floors on its behalf).
  function cancel() {
    const flying = flight.running;
    ticketNow++;
    docking = false;
    stopMove();
    flight.stop();
    if (flying) settle(lastDestination);
    marker.visible = false;
    schedule();
  }
  // The story's camera moves; one that takes over a flight to the car park (Play tapped on the way) settles it there.
  function fly(pose, ms) {
    stopMove();
    if (docking) {
      docking = false;
      settle('parking');
    }
    ticketNow++;
    return flight.flyPath([
      {
        to: pose,
        duration: ms,
        onUpdate() {
          schedule();
        },
      },
    ]);
  }
  async function navigate(id, {instant = false, onPhase = () => {}, onApproach = () => {}} = {}) {
    flight.stop();
    stopMove();
    const ticket = ++ticketNow,
      start = readPose();
    marker.visible = false;
    markerMaterial.opacity = 0.6;
    const settings = {
      meeting: {
        eye: meetingTarget
          .clone()
          .add(new THREE.Vector3(5, 7, 8))
          .toArray(),
        target: meetingTarget.toArray(),
        fov: 43,
      },
      ...objectPoses(),
      parking: parkingPose,
    };
    const to = settings[id] || contextPose(),
      quick = instant || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (quick) {
      sceneTransition.finish();
      applyDestination(id);
      writePose(to);
      lastDestination = id;
      return true;
    }
    const local =
      lastDestination !== id &&
      stops[id].level === stops[lastDestination].level &&
      settings[lastDestination] &&
      new THREE.Vector3(...settings[lastDestination].target).distanceTo(new THREE.Vector3(...to.target)) < 15;
    const same = id === lastDestination;
    const distance = new THREE.Vector3(...start.eye).distanceTo(new THREE.Vector3(...to.eye));
    if (same && distance < 0.1) {
      sceneTransition.finish();
      return true;
    } // there already (a repeat tap mid-approach): its change ends
    const phases = [];
    if (local || same) {
      // A nearby spot on the same floor (or this stop again): a short step back, then in.
      const retreat = {
        eye: new THREE.Vector3(...start.target)
          .add(new THREE.Vector3(...start.eye).sub(new THREE.Vector3(...start.target)).multiplyScalar(1.3))
          .toArray(),
        target: start.target,
        fov: start.fov,
      };
      if (!same)
        phases.push({
          to: retreat,
          duration: 400,
          onStart() {
            onPhase(L('ถอยออกจากจุดเดิม', 'Pulling back'));
          },
        });
      phases.push({
        to,
        duration: local ? 750 : 550,
        onStart() {
          onPhase(L('กำลังเข้าใกล้จุดหมาย', 'Approaching'));
          lastDestination = id;
          sceneTransition.begin(() => applyDestination(id));
          onApproach();
        },
        onUpdate(t) {
          sceneTransition.progress(Math.min(1, t / 0.75));
        },
        onEnd() {
          sceneTransition.finish();
        },
      });
    } else {
      // Another stop: one continuous flight that swings out far enough to show where the next stop sits on the
      // building, without first returning to the overview. The curve bends towards the whole-building view from
      // between the two stops' viewing directions. The floors change in two fades, as the camera swings out and as
      // it comes in: the whole building first, then the new stop's cut. One fade straight from one cut to the other
      // showed both half-faded at once (floor 4's furniture over floor 1, a see-through ghost of the building).
      const facing = (pose) => new THREE.Vector3(...pose.eye).sub(new THREE.Vector3(...pose.target)).normalize();
      const direction = facing(start).add(facing(to));
      if (direction.lengthSq() < 0.01) direction.copy(facing(start));
      direction.normalize();
      direction.y = Math.max(0.35, direction.y);
      const via = contextPose(direction),
        span = new THREE.Vector3(...start.eye).distanceTo(new THREE.Vector3(...to.eye));
      marker.position.set(to.target[0], stops[id].marker(to.target[1]), to.target[2]);
      marker.visible = id !== 'overview';
      const SPLIT = 0.45;
      let approached = false;
      // The stop's title and panel arrive as the camera starts its descent onto it, with its floors' fade.
      // From here the scene is the new stop's (lastDestination: a cancelled flight settles on it).
      const approach = () => {
        approached = true;
        lastDestination = id;
        sceneTransition.finish({settled: false});
        onPhase(L('กำลังเข้าใกล้จุดหมาย', 'Approaching'));
        sceneTransition.begin(() => applyDestination(id));
        onApproach();
      };
      phases.push({
        to,
        via,
        duration: Math.round(THREE.MathUtils.clamp(1100 + span * 12, 1300, 1900)),
        onStart() {
          onPhase(L('กำลังเดินทาง', 'On the way'));
          sceneTransition.begin(() => applyDestination('overview'));
        },
        onUpdate(t) {
          if (!approached && t >= SPLIT) approach();
          sceneTransition.progress(approached ? THREE.MathUtils.clamp((t - SPLIT) / (0.95 - SPLIT), 0, 1) : t / SPLIT);
          markerMaterial.opacity = 0.6 * Math.min(1, t * 4) * (1 - t);
        },
        onEnd() {
          if (!approached) approach();
          sceneTransition.finish();
        },
      });
    }
    docking = true;
    const arrived = await flight.flyPath(phases);
    if (ticket === ticketNow) {
      docking = false;
      marker.visible = false;
      markerMaterial.opacity = 0.6;
      if (arrived) lastDestination = id;
      schedule();
    }
    return arrived;
  }

  return {navigate, cancel, fly, move, stopMove};
}
