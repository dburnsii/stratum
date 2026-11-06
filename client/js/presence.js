// Presence: see the other people in a shared Space. DESIGN.md §5.1.
//
// Each device sends its head pose in the Space's frame a few times a second
// (WebSocket "pose", hot and droppable); the server relays it to everyone
// else subscribed to that Space. Others show as a soft head with a facing
// visor and a name tag, parented to the Space root, so they're world-locked
// the same way objects are, whatever each device's own world origin is.
//
//   const presence = new Presence(world, live, { kind: 'phone' });
//   presence.update(now, viewer)   // every frame (viewer = { position, quaternion } world)
import * as THREE from 'three';

const SEND_MS = 200;
const STALE_MS = 5000;              // no pose for this long → gone
const SMOOTH_S = 0.12;

export class Presence {
  constructor(world, live, { kind = 'phone' } = {}) {
    this.world = world;
    this.live = live;
    this.kind = kind;
    this.others = new Map();        // conn id -> { group, target: {p, q}, space, seen, name }
    this.lastSent = 0;
    live.handlers.pose = (m) => this.onPose(m);
    live.handlers.gone = (m) => this.remove(m.from);
  }

  get count() { return this.others.size; }

  update(now, dt, viewer) {
    // Send: my pose in each aligned saved Space (only Spaces others can be in).
    if (viewer && now - this.lastSent > SEND_MS) {
      this.lastSent = now;
      const mine = new THREE.Matrix4().compose(viewer.position, viewer.quaternion, new THREE.Vector3(1, 1, 1));
      for (const s of this.world.spaces.values()) {
        if (!s.aligned || s.temporary || (s.members?.length ?? 0) < 2) continue;
        const local = s.root.matrix.clone().invert().multiply(mine);
        const p = new THREE.Vector3(), q = new THREE.Quaternion();
        local.decompose(p, q, new THREE.Vector3());
        this.live.send({ t: 'pose', space: s.id, p: round(p.toArray()), q: round(q.toArray()), device: this.kind });
      }
    }
    // Draw: ease toward the latest pose; drop the silent.
    const k = 1 - Math.exp(-dt / SMOOTH_S);
    for (const [id, o] of this.others) {
      if (now - o.seen > STALE_MS) { this.remove(id); continue; }
      o.group.position.lerp(o.target.p, k);
      o.group.quaternion.slerp(o.target.q, k);
    }
  }

  onPose(m) {
    const space = this.world.spaces.get(m.space);
    if (!space) return;
    let o = this.others.get(m.from);
    if (!o || o.space !== space) {
      this.remove(m.from);
      o = { group: avatar(m.name, m.device), space, target: { p: new THREE.Vector3(), q: new THREE.Quaternion() }, name: m.name };
      o.group.position.fromArray(m.p);
      o.group.quaternion.fromArray(m.q);
      space.root.add(o.group);
      this.others.set(m.from, o);
    }
    o.target.p.fromArray(m.p);
    o.target.q.fromArray(m.q);
    o.seen = performance.now();
  }

  remove(id) {
    const o = this.others.get(id);
    if (!o) return;
    o.group.removeFromParent();
    o.group.traverse((n) => { n.geometry?.dispose(); n.material?.map?.dispose(); n.material?.dispose(); });
    this.others.delete(id);
  }

  clear() { for (const id of [...this.others.keys()]) this.remove(id); }

  names() { return [...this.others.values()].map((o) => o.name); }
}

const round = (a) => a.map((v) => Math.round(v * 1000) / 1000);

function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.6);
}

// A soft head: translucent sphere, a dark visor showing where they look
// (-z is forward in WebXR view space), and a name tag above.
function avatar(name, device) {
  const g = new THREE.Group();
  const color = colorFor(name);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true, opacity: 0.8 }));
  head.position.z = 0.09;   // the eyes/phone are in front of the head's center
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.086, 24, 12, Math.PI * 1.2, Math.PI * 0.6, Math.PI * 0.33, Math.PI * 0.3),
    new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.15, metalness: 0.3 }));
  visor.position.copy(head.position);
  const tag = nameTag(`${device === 'quest' ? '🥽' : '📱'} ${name}`);
  tag.position.set(0, 0.16, 0.09);
  g.add(head, visor, tag);
  g.userData.presence = name;
  return g;
}

function nameTag(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.font = '600 56px system-ui, sans-serif';
  const w = Math.min(500, x.measureText(text).width + 56);
  x.fillStyle = 'rgba(12,14,20,0.8)';
  x.beginPath(); x.roundRect((512 - w) / 2, 20, w, 88, 44); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 66, 460);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.24, 0.06, 1);
  s.renderOrder = 900;
  return s;
}
