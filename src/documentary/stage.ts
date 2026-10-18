import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

type Shot = { pos: THREE.Vector3; look: THREE.Vector3; fog: THREE.Color; density: number };

export class DocumentaryStage {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private fog: THREE.FogExp2;
  private worlds = new Map<string, THREE.Group>();
  private shots: Record<string, Shot> = {};
  private anims: Array<{ id: string; fn: (t: number, local: number) => void }> = [];
  private geos = new Set<THREE.BufferGeometry>();
  private mats = new Set<THREE.Material>();
  private box: THREE.BoxGeometry;
  private sphere: THREE.SphereGeometry;
  private current = "";
  private elapsed = 0;
  private last = performance.now();
  private pointer = { x: 0, y: 0 };
  private camT = new THREE.Vector3(4, 2, 6);
  private look = new THREE.Vector3(0, 1, 0);
  private lookT = new THREE.Vector3(0, 1, 0);
  private reduce: boolean;
  private envTex: THREE.Texture;
  private pmrem: THREE.PMREMGenerator;
  private dir = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0x07080b, 0.04);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x07080b);
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 80);
    this.camera.position.copy(this.camT);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;

    const hemi = new THREE.HemisphereLight(0xd5e0ea, 0x3a2c20, 1.45);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e4, 4.4);
    sun.position.set(7, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 32;
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    this.scene.add(sun);

    this.box = this.geo(new THREE.BoxGeometry(1, 1, 1));
    this.sphere = this.geo(new THREE.SphereGeometry(1, 24, 16));

    this.buildRoad();
    this.buildBell();
    this.buildBars("ipo", 0xd4782a, false);
    this.buildBars("crash", 0x8e2e2a, true);
    this.buildWheel();
    this.buildCloud();
    this.buildKindle();
    this.buildEcho();
    this.buildStreet();
    this.buildFleet();
    this.buildRift();
    this.buildMind();
    this.resize();
  }

  setPointer(x: number, y: number) {
    this.pointer.x = x;
    this.pointer.y = y;
  }

  resize() {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || canvas.clientWidth || 640;
    const h = parent?.clientHeight || canvas.clientHeight || 360;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(world: string, localT: number) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dt;
    const id = this.worlds.has(world) ? world : "road";
    if (id !== this.current) {
      for (const [key, group] of this.worlds) group.visible = key === id;
      this.current = id;
    }
    for (const anim of this.anims) {
      if (anim.id === id || anim.id === "*") anim.fn(this.elapsed, localT);
    }
    this.shot(id, localT);
    const k = 1 - Math.exp(-3.2 * dt);
    this.camera.position.lerp(this.camT, k);
    this.look.lerp(this.lookT, k);
    this.camera.lookAt(this.look);
    const shot = this.shots[id];
    const bg = this.scene.background as THREE.Color;
    if (shot) {
      bg.lerp(shot.fog, k);
      this.fog.color.copy(bg);
      this.fog.density += (shot.density - this.fog.density) * k;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const geo of this.geos) geo.dispose();
    for (const mat of this.mats) {
      const mapped = mat as THREE.MeshStandardMaterial;
      mapped.map?.dispose();
      mat.dispose();
    }
    this.envTex.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }

  private shot(world: string, localT: number) {
    const base = this.shots[world] ?? this.shots.road;
    if (!base) return;
    if (world === "cloud") {
      this.camT.set(0.25, 1.45, 5.2 - localT * 7.2);
      this.lookT.set(0, 1.4, this.camT.z - 4);
    } else {
      this.dir.subVectors(base.look, base.pos).normalize();
      const dolly = this.reduce ? 0 : (localT - 0.5) * 1.15;
      this.camT.copy(base.pos).addScaledVector(this.dir, dolly);
      this.lookT.copy(base.look);
    }
    if (!this.reduce) {
      this.camT.x += this.pointer.x * 0.22;
      this.camT.y += -this.pointer.y * 0.1;
    }
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T) {
    this.geos.add(geometry);
    return geometry;
  }

  private mat<T extends THREE.Material>(material: T) {
    this.mats.add(material);
    return material;
  }

  private std(color: number, rough = 0.6, metal = 0.15, emissive = 0x000000, emissiveIntensity = 0) {
    return this.mat(
      new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness: metal,
        emissive,
        emissiveIntensity,
      }),
    );
  }

  private ground(parent: THREE.Group, color: number, rough = 0.85, metal = 0.05) {
    const mesh = new THREE.Mesh(this.geo(new THREE.CircleGeometry(28, 48)), this.std(color, rough, metal));
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    shadow = false,
  ) {
    const mesh = new THREE.Mesh(this.box, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private define(id: string, pos: [number, number, number], look: [number, number, number], fog: number, density: number) {
    const group = new THREE.Group();
    group.visible = false;
    this.scene.add(group);
    this.worlds.set(id, group);
    this.shots[id] = {
      pos: new THREE.Vector3(...pos),
      look: new THREE.Vector3(...look),
      fog: new THREE.Color(fog),
      density,
    };
    return group;
  }

  private buildRoad() {
    const g = this.define("road", [4.4, 1.75, 6.1], [0, 1.05, 0.2], 0x24303c, 0.02);
    this.ground(g, 0x2a3038, 0.4, 0.45);
    const asphalt = this.std(0x1a1e24, 0.35, 0.45);
    this.addBox(g, 3.4, 0.04, 18, asphalt, 1.6, 0.02, 1.2);
    const paint = this.std(0xf3eadc, 0.5, 0);
    for (let i = 0; i < 7; i++) this.addBox(g, 0.08, 0.05, 0.7, paint, 1.6, 0.05, -4 + i * 1.6);
    const house = this.std(0x4a3a32, 0.72, 0.05);
    this.addBox(g, 2.5, 1.5, 2.2, house, -1.3, 0.75, -1.2, true);
    const roof = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.95, 0.85, 4)), this.std(0x3a241c, 0.7, 0.05));
    roof.position.set(-1.3, 1.9, -1.2);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    const windowMat = this.std(0xffc38a, 0.3, 0, 0xff9a45, 1.4);
    this.addBox(g, 0.55, 0.6, 0.06, windowMat, -0.45, 1.05, -0.08);
    this.addBox(g, 1.15, 1.05, 0.08, this.std(0x100e0c, 0.8), -1.35, 0.55, -0.08);
    const warm = new THREE.PointLight(0xffb26b, 14, 10);
    warm.position.set(-1.2, 1.1, 0.4);
    g.add(warm);
    const card = this.std(0xb5895a, 0.72, 0.05);
    const spots: Array<[number, number, number, number]> = [
      [0.2, 0.28, 0.9, 0.5],
      [0.55, 0.22, 1.15, 0.4],
      [-0.15, 0.34, 1.25, 0.55],
      [0.4, 0.5, 0.85, 0.36],
      [0.85, 0.2, 0.7, 0.42],
    ];
    for (const [x, h, z, w] of spots) this.addBox(g, w, h, w * 0.9, card, x, h / 2, z, true);
    const spine = [0x6e2e24, 0x1e3a4c, 0xd4782a, 0x2c4a3e, 0x8a7048, 0xf3eadc, 0x4a3048];
    spine.forEach((color, i) => {
      this.addBox(g, 0.16, 0.42, 0.28, this.std(color, 0.65), -0.35 + i * 0.16, 0.21, 1.7, true);
    });
    const body = this.std(0x1b1916, 0.4, 0.55);
    this.addBox(g, 1.7, 0.42, 0.78, body, 2.5, 0.32, 2.15, true);
    this.addBox(g, 0.85, 0.34, 0.7, this.std(0x101216, 0.2, 0.4), 2.25, 0.66, 2.15);
    this.addBox(g, 0.06, 0.1, 0.62, this.std(0xff4a32, 0.4, 0, 0xff2a18, 0.9), 3.32, 0.36, 2.15);
    const moon = new THREE.Mesh(this.sphere, this.std(0xf3eadc, 0.4, 0, 0xf3eadc, 0.7));
    moon.scale.setScalar(0.38);
    moon.position.set(-6, 6.5, -8);
    g.add(moon);
    for (let i = 0; i < 9; i++) {
      const tree = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.45, 1.6, 6)), this.std(0x1a241c, 0.9));
      tree.position.set(-6 + i * 1.1, 0.8, -5.5 - (i % 3) * 0.4);
      g.add(tree);
    }
    const rainGeo = this.geo(new THREE.BufferGeometry());
    const count = this.reduce ? 0 : 520;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 1] = Math.random() * 9;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
      speeds[i] = 3.5 + Math.random() * 4;
    }
    rainGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const rain = new THREE.Points(
      rainGeo,
      this.mat(new THREE.PointsMaterial({ color: 0xd5e2ea, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false })),
    );
    g.add(rain);
    this.anims.push({
      id: "road",
      fn: (t) => {
        const attr = rainGeo.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          let y = attr.getY(i) - speeds[i] * 0.016;
          if (y < 0) y = 8;
          attr.setY(i, y);
          attr.setX(i, attr.getX(i) + Math.sin(t + i) * 0.002);
        }
        attr.needsUpdate = true;
      },
    });
  }

  private buildBell() {
    const g = this.define("bell", [1.7, 1.55, 3.4], [0, 0.95, 0], 0x1c1612, 0.042);
    this.ground(g, 0x1a1614, 0.8, 0.08);
    this.addBox(g, 2.4, 0.12, 1.2, this.std(0x4a3428, 0.55, 0.1), 0, 0.72, 0, true);
    const bell = new THREE.Group();
    const shell = new THREE.Mesh(this.sphere, this.std(0xd4782a, 0.32, 0.72, 0x6a3410, 0.25));
    shell.scale.set(0.28, 0.22, 0.28);
    const handle = new THREE.Mesh(this.box, this.std(0x8a5a32, 0.4, 0.4));
    handle.scale.set(0.06, 0.22, 0.06);
    handle.position.y = 0.2;
    bell.add(shell, handle);
    bell.position.set(0.15, 1.15, 0);
    g.add(bell);
    const lamp = new THREE.PointLight(0xffc48a, 7, 7);
    lamp.position.set(0, 2.2, 0.6);
    g.add(lamp);
    const spines = [0x6e2e24, 0x1e3a4c, 0xd4782a, 0x234238, 0x8d7044, 0xe7dcc8, 0x4a3048, 0x6fbfb8, 0x2a2e38];
    const books: THREE.Mesh[] = [];
    for (let i = 0; i < 42; i++) {
      const mesh = new THREE.Mesh(this.box, this.std(spines[i % spines.length], 0.62));
      const h = 0.28 + (i % 5) * 0.06;
      mesh.scale.set(0.14, h, 0.22);
      const ang = i * 0.55;
      const rad = 0.7 + (i % 7) * 0.18;
      mesh.position.set(Math.cos(ang) * rad, 0.78 + h / 2, Math.sin(ang) * rad * 0.55);
      mesh.rotation.y = -ang;
      mesh.castShadow = true;
      g.add(mesh);
      books.push(mesh);
    }
    this.anims.push({
      id: "bell",
      fn: (t) => {
        bell.rotation.z = Math.sin(t * 2.4) * 0.12;
        books.forEach((book, i) => {
          book.position.y += Math.sin(t * 1.4 + i) * 0.0015;
        });
      },
    });
  }

  private buildBars(id: string, color: number, crash: boolean) {
    const shot = crash
      ? { pos: [-2.2, 2.1, 6.6] as [number, number, number], fog: 0x180d0d, density: 0.04 }
      : { pos: [0.4, 2.5, 7.4] as [number, number, number], fog: 0x120e0c, density: 0.03 };
    const g = this.define(id, shot.pos, [0, 1.3, 0], shot.fog, shot.density);
    this.ground(g, crash ? 0x140c0c : 0x14110e, 0.25, 0.7);
    const n = 40;
    const material = this.std(color, 0.35, 0.55, color, crash ? 0.15 : 0.35);
    const mesh = new THREE.InstancedMesh(this.box, material, n);
    mesh.castShadow = true;
    const dummy = new THREE.Object3D();
    const xs: number[] = [];
    const zs: number[] = [];
    const hs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = ((i % 10) - 4.5) * 0.62;
      const z = (Math.floor(i / 10) - 1.5) * 0.85;
      const h = 0.35 + ((i * 37) % 100) / 40;
      xs.push(x);
      zs.push(z);
      hs.push(h);
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(0.32, h, 0.32);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const tone = crash ? (i === 17 ? 0x6fbfb8 : 0xa33a32) : 0xd4782a;
      mesh.setColorAt(i, new THREE.Color(tone));
    }
    g.add(mesh);
    this.anims.push({
      id,
      fn: (t, local) => {
        for (let i = 0; i < n; i++) {
          let h = hs[i] * (0.82 + 0.18 * Math.sin(t * 1.5 + i * 0.6));
          if (crash) h *= i === 17 ? 0.25 + local * 1.8 : Math.max(0.12, 1 - local * 0.75);
          dummy.position.set(xs[i], h / 2, zs[i]);
          dummy.scale.set(0.32, Math.max(0.05, h), 0.32);
          dummy.rotation.z = crash && i % 9 === 0 ? local * 0.4 : 0;
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
    });
  }

  private buildWheel() {
    const g = this.define("wheel", [4.2, 2.4, 4.2], [0, 1.1, 0], 0x140f0c, 0.028);
    this.ground(g, 0x14110e, 0.3, 0.55);
    const ring = new THREE.Mesh(
      this.geo(new THREE.TorusGeometry(1.35, 0.045, 16, 80)),
      this.std(0xd4782a, 0.28, 0.75, 0x8a4012, 0.45),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.25;
    g.add(ring);
    const orbit = new THREE.Group();
    g.add(orbit);
    const card = this.std(0xc49a62, 0.6, 0.08);
    for (let i = 0; i < 9; i++) {
      const box = new THREE.Mesh(this.box, card);
      box.scale.set(0.38, 0.26, 0.48);
      const ang = (i / 9) * Math.PI * 2;
      box.position.set(Math.cos(ang) * 2.15, 1.25, Math.sin(ang) * 2.15);
      box.lookAt(0, 1.25, 0);
      box.castShadow = true;
      orbit.add(box);
    }
    const arrowA = this.addBox(g, 0.7, 0.06, 0.12, this.std(0xd4782a, 0.3, 0.6, 0x8a4012, 0.4), 0.1, 1.25, 0);
    arrowA.rotation.y = 0.6;
    const arrowB = this.addBox(g, 0.7, 0.06, 0.12, this.std(0xd4782a, 0.3, 0.6, 0x8a4012, 0.4), 0.1, 1.25, 0);
    arrowB.rotation.y = -0.6;
    this.anims.push({
      id: "wheel",
      fn: (t) => {
        orbit.rotation.y = t * 0.35;
        ring.rotation.z = t * 0.15;
      },
    });
  }

  private buildCloud() {
    const g = this.define("cloud", [0.2, 1.5, 5.4], [0, 1.4, 0], 0x071614, 0.05);
    this.ground(g, 0x0c1414, 0.4, 0.35);
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#071412";
      ctx.fillRect(0, 0, 32, 128);
      for (let i = 0; i < 8; i++) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = i % 2 === 0 ? "#6fbfb8" : "#d4782a";
        ctx.fillRect(6, i * 16 + 2, 20, 6);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const strip = this.mat(
      new THREE.MeshStandardMaterial({
        map: tex,
        emissive: 0x6fbfb8,
        emissiveMap: tex,
        emissiveIntensity: 0.85,
        roughness: 0.4,
        metalness: 0.2,
      }),
    );
    const rack = this.std(0x12181a, 0.35, 0.75);
    for (let i = 0; i < 12; i++) {
      const z = 3.2 - i * 1.15;
      this.addBox(g, 0.7, 1.7, 0.45, rack, -0.85, 0.85, z, true);
      this.addBox(g, 0.7, 1.7, 0.45, rack, 0.85, 0.85, z, true);
      const left = this.addBox(g, 0.62, 1.45, 0.04, strip, -0.85, 0.9, z + 0.24);
      const right = this.addBox(g, 0.62, 1.45, 0.04, strip, 0.85, 0.9, z + 0.24);
      left.castShadow = false;
      right.castShadow = false;
    }
    const glow = new THREE.PointLight(0x6fbfb8, 4, 10);
    glow.position.set(0, 1.6, 0);
    g.add(glow);
    this.anims.push({
      id: "cloud",
      fn: (t) => {
        tex.offset.y = t * 0.25;
      },
    });
  }

  private buildKindle() {
    const g = this.define("kindle", [0.5, 1.25, 3.5], [0, 1.05, 0], 0x141310, 0.036);
    this.ground(g, 0x161410, 0.7, 0.15);
    this.addBox(g, 1.35, 1.9, 0.08, this.std(0x1a1c20, 0.35, 0.6), 0, 1.15, 0, true);
    this.addBox(g, 1.15, 1.55, 0.02, this.std(0xd9d3c4, 0.85, 0, 0xe7e0d0, 0.18), 0, 1.18, 0.05);
    const dustGeo = this.geo(new THREE.BufferGeometry());
    const n = 180;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 3;
      pos[i * 3 + 1] = Math.random() * 2.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(
      dustGeo,
      this.mat(new THREE.PointsMaterial({ color: 0xf3eadc, size: 0.03, transparent: true, opacity: 0.7, depthWrite: false })),
    );
    g.add(dust);
    const lamp = new THREE.SpotLight(0xf3eadc, 10, 8, 0.45, 0.5);
    lamp.position.set(1.2, 3.2, 2.2);
    lamp.target.position.set(0, 1, 0);
    g.add(lamp, lamp.target);
    this.anims.push({
      id: "kindle",
      fn: (t) => {
        const attr = dustGeo.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < n; i++) {
          let z = attr.getZ(i) - 0.01;
          if (z < -0.2) {
            attr.setX(i, (Math.random() - 0.5) * 3);
            attr.setY(i, Math.random() * 2.2);
            z = 1.2;
          }
          attr.setZ(i, z);
        }
        attr.needsUpdate = true;
        dust.rotation.y = t * 0.05;
      },
    });
  }

  private buildEcho() {
    const g = this.define("echo", [2.3, 1.45, 3.8], [0.2, 0.9, 0], 0x10131a, 0.032);
    this.ground(g, 0x12141a, 0.45, 0.4);
    const glass = this.std(0x20242c, 0.15, 0.7);
    const shards: Array<[number, number, number, number]> = [
      [-1.3, 0.04, 0.2, 0.5],
      [-0.9, 0.05, -0.2, -0.4],
      [-1.6, 0.03, -0.35, 0.8],
      [-1.1, 0.06, 0.55, -0.9],
    ];
    for (const [x, y, z, rot] of shards) {
      const shard = this.addBox(g, 0.45, 0.03, 0.22, glass, x, y, z);
      shard.rotation.y = rot;
      shard.rotation.z = rot * 0.2;
    }
    const body = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.38, 0.42, 1.15, 28)), this.std(0x1c1e22, 0.28, 0.7));
    body.position.set(0.35, 0.58, 0);
    body.castShadow = true;
    g.add(body);
    const halo = new THREE.Mesh(
      this.geo(new THREE.TorusGeometry(0.28, 0.025, 12, 40)),
      this.std(0x6fbfb8, 0.25, 0.4, 0x6fbfb8, 1.2),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0.35, 1.18, 0);
    g.add(halo);
    const light = new THREE.PointLight(0x6fbfb8, 4, 5);
    light.position.set(0.35, 1.3, 0);
    g.add(light);
    this.anims.push({
      id: "echo",
      fn: (t) => {
        halo.position.y = 1.16 + Math.sin(t * 2) * 0.03;
        const mat = halo.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.5;
      },
    });
  }

  private buildStreet() {
    const g = this.define("street", [3.4, 1.7, 4.6], [0, 1, 0], 0x10150f, 0.032);
    this.ground(g, 0x1a1c18, 0.75, 0.08);
    this.addBox(g, 3.2, 1.8, 0.2, this.std(0x2a2924, 0.6, 0.1), 0, 0.9, -1.4, true);
    const glass = this.mat(
      new THREE.MeshStandardMaterial({
        color: 0x9fd2c8,
        roughness: 0.05,
        metalness: 0.1,
        transparent: true,
        opacity: 0.28,
      }),
    );
    this.addBox(g, 1.8, 1.2, 0.04, glass, 0, 0.9, -1.28);
    const produce = [0x2f6b3a, 0xc45a3a, 0xd4782a, 0xe7d7a2, 0x6fbfb8];
    produce.forEach((color, i) => {
      this.addBox(g, 0.32, 0.28, 0.32, this.std(color, 0.55), -0.8 + i * 0.4, 0.14, 0.2, true);
    });
    const ring = new THREE.Mesh(
      this.geo(new THREE.TorusGeometry(0.55, 0.03, 12, 40)),
      this.std(0xe2c27a, 0.3, 0.8, 0xe2c27a, 0.4),
    );
    ring.position.set(0, 2.4, -0.4);
    g.add(ring);
    const lamp = new THREE.PointLight(0xffe1b0, 5, 8);
    lamp.position.set(0, 2.2, 0.6);
    g.add(lamp);
    this.anims.push({
      id: "street",
      fn: (t, local) => {
        ring.rotation.x = t * 0.4;
        ring.rotation.y = t * 0.25;
        ring.position.y = 2.1 + local * 0.8;
      },
    });
  }

  private buildFleet() {
    const g = this.define("fleet", [0.2, 2.3, 7.2], [0, 0.7, 0], 0x0c1018, 0.04);
    this.ground(g, 0x10131a, 0.32, 0.5);
    this.addBox(g, 2.2, 0.03, 16, this.std(0x1c212b, 0.4, 0.3), 0, 0.02, 0);
    const vanMat = this.std(0x2a241c, 0.45, 0.35);
    const vans: THREE.Group[] = [];
    for (let i = 0; i < 4; i++) {
      const van = new THREE.Group();
      this.addBox(van, 1.3, 0.7, 0.62, vanMat, 0, 0.5, 0, true);
      this.addBox(van, 0.45, 0.4, 0.55, this.std(0x141820, 0.2, 0.4), 0.35, 0.85, 0);
      this.addBox(van, 0.05, 0.08, 0.4, this.std(0xfff1dc, 0.3, 0, 0xfff1dc, 0.8), 0.66, 0.5, 0);
      van.position.z = -4 + i * 2.4;
      g.add(van);
      vans.push(van);
    }
    const chair = this.std(0x241c18, 0.7, 0.1);
    this.addBox(g, 0.45, 0.08, 0.45, chair, -0.7, 0.48, 1.4, true);
    this.addBox(g, 0.45, 0.55, 0.08, chair, -0.7, 0.75, 1.18);
    this.addBox(g, 0.45, 0.08, 0.45, chair, 0.7, 0.48, 1.4, true);
    this.addBox(g, 0.45, 0.55, 0.08, chair, 0.7, 0.75, 1.18);
    const spot = new THREE.SpotLight(0xf3eadc, 12, 10, 0.35, 0.4);
    spot.position.set(0, 4.5, 2.2);
    spot.target.position.set(-0.7, 0.5, 1.4);
    g.add(spot, spot.target);
    this.anims.push({
      id: "fleet",
      fn: (t) => {
        vans.forEach((van, i) => {
          van.position.z = ((t * 1.4 + i * 2.2) % 10) - 5;
        });
        spot.target.position.x = Math.sin(t * 0.45) > 0 ? 0.7 : -0.7;
      },
    });
  }

  private buildRift() {
    const g = this.define("rift", [3.1, 1.9, 5.2], [0, 1, -0.4], 0x16110e, 0.038);
    this.ground(g, 0x1a1614, 0.8, 0.08);
    const table = this.std(0x3a3028, 0.6, 0.05);
    for (let i = 0; i < 6; i++) {
      this.addBox(g, 0.7, 0.08, 0.4, table, -2.2 + i * 0.85, 0.72, -1.3);
      const bulb = new THREE.PointLight(0xffb36a, 1.5, 2.2);
      bulb.position.set(-2.2 + i * 0.85, 1.3, -1.3);
      g.add(bulb);
    }
    const cloth = this.std(0x2c333d, 0.8);
    const skin = this.std(0xc49a78, 0.7);
    const lit = this.std(0x6fbfb8, 0.55, 0.1, 0x245e58, 0.2);
    const disc = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.9, 32)), this.std(0x1c3e3a, 0.5, 0.1, 0x6fbfb8, 0.35));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(0.4, 0.03, 0.4);
    g.add(disc);
    for (let i = 0; i < 8; i++) {
      const fig = new THREE.Group();
      const body = new THREE.Mesh(this.box, i > 4 ? lit : cloth);
      body.scale.set(0.28, 0.7, 0.2);
      body.position.y = 0.55;
      const head = new THREE.Mesh(this.sphere, skin);
      head.scale.setScalar(0.13);
      head.position.y = 1.05;
      fig.add(body, head);
      fig.position.set(-1.8 + i * 0.55, 0, i > 4 ? 0.45 : 1.1);
      g.add(fig);
    }
    const crack = this.addBox(g, 4.2, 0.03, 0.06, this.std(0x6fbfb8, 0.3, 0.2, 0x6fbfb8, 0.8), 0, 0.04, 0.15);
    crack.rotation.y = 0.15;
  }

  private buildMind() {
    const g = this.define("mind", [0.2, 2.1, 6.4], [0, 1.25, 0], 0x080a12, 0.026);
    this.ground(g, 0x0c0e14, 0.35, 0.55);
    const core = new THREE.Mesh(
      this.geo(new THREE.IcosahedronGeometry(0.62, 1)),
      this.std(0xd4782a, 0.22, 0.8, 0x8a3c10, 0.35),
    );
    core.position.y = 1.35;
    core.castShadow = true;
    const wire = new THREE.Mesh(
      this.geo(new THREE.IcosahedronGeometry(1.15, 1)),
      this.mat(new THREE.MeshBasicMaterial({ color: 0x6fbfb8, wireframe: true, transparent: true, opacity: 0.55 })),
    );
    wire.position.y = 1.35;
    g.add(core, wire);
    const ringA = new THREE.Mesh(this.geo(new THREE.TorusGeometry(1.7, 0.015, 8, 80)), this.std(0xf3eadc, 0.3, 0.6, 0xf3eadc, 0.2));
    const ringB = new THREE.Mesh(this.geo(new THREE.TorusGeometry(2.15, 0.012, 8, 80)), this.std(0x6fbfb8, 0.3, 0.5, 0x6fbfb8, 0.35));
    ringA.position.y = 1.35;
    ringB.position.y = 1.35;
    ringA.rotation.x = 1.1;
    ringB.rotation.x = 0.4;
    g.add(ringA, ringB);
    const count = 240;
    const geo = this.geo(new THREE.BufferGeometry());
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2.2 + Math.random() * 0.4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = 1.35 + r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      geo,
      this.mat(new THREE.PointsMaterial({ color: 0xf3eadc, size: 0.035, transparent: true, opacity: 0.8, depthWrite: false })),
    );
    g.add(stars);
    const arc = new THREE.Mesh(
      this.geo(new THREE.TorusGeometry(2.4, 0.02, 8, 60, Math.PI * 0.85)),
      this.std(0xd4782a, 0.25, 0.6, 0xd4782a, 0.7),
    );
    arc.position.y = 1.2;
    g.add(arc);
    this.anims.push({
      id: "mind",
      fn: (t) => {
        core.rotation.y = t * 0.25;
        core.rotation.x = t * 0.12;
        wire.rotation.y = -t * 0.18;
        ringA.rotation.z = t * 0.2;
        ringB.rotation.z = -t * 0.14;
        stars.rotation.y = t * 0.05;
      },
    });
  }
}
