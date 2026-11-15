import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";

export type PaperFlipHandle = { turn: (direction: number) => void };
type Props = {
  pageWidth: number; height: number; spread: boolean;
  front: (direction: number) => HTMLCanvasElement;
  back: (direction: number) => HTMLCanvasElement;
  canTurn: (direction: number) => boolean;
  onTurn: (direction: number) => void;
  onActive: (direction: number) => void;
  onError: () => void;
};

export default forwardRef<PaperFlipHandle, Props>(function PaperFlip(props, ref) {
  const mount = useRef<HTMLDivElement>(null), shadow = useRef<HTMLDivElement>(null), latest = useRef(props), frame = useRef(0);
  const [visible, setVisible] = useState(false);
  const drag = useRef({ dir: 1, progress: 0, startX: 0, moved: 0, active: false, settling: false });
  const gl = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; front: THREE.Mesh; back: THREE.Mesh } | null>(null);
  latest.current = props;
  const stageWidth = props.spread ? props.pageWidth * 2 + 8 : props.pageWidth;
  useEffect(() => {
    let renderer: THREE.WebGLRenderer | undefined;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(stageWidth, props.height);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.current?.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, stageWidth / props.height, 1, 12000);
      camera.position.set(0, 0, props.height / (2 * Math.tan(35 * Math.PI / 360)));
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 1.8));
      const light = new THREE.DirectionalLight(0xfff4df, .7);
      light.position.set(-props.pageWidth, props.height, 700); scene.add(light);
      const geometry = new THREE.PlaneGeometry(props.pageWidth, props.height, 64, 24);
      const front = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.FrontSide, roughness: .95 }));
      const back = new THREE.Mesh(geometry.clone(), new THREE.MeshStandardMaterial({ side: THREE.BackSide, roughness: .95 }));
      scene.add(front, back);
      gl.current = { renderer, scene, camera, front, back };
      const lost = (event: Event) => { event.preventDefault(); latest.current.onError(); };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      return () => {
        cancelAnimationFrame(frame.current); drag.current.active = false;
        renderer?.domElement.removeEventListener("webglcontextlost", lost);
        [front, back].forEach(mesh => { mesh.geometry.dispose(); const material = mesh.material as THREE.MeshStandardMaterial; material.map?.dispose(); material.dispose(); });
        renderer?.dispose(); renderer?.domElement.remove(); gl.current = null;
      };
    } catch {
      renderer?.dispose(); renderer?.domElement.remove(); latest.current.onError();
    }
  }, [stageWidth, props.pageWidth, props.height]);
  function render(progress: number) {
    const s = gl.current; if (!s) return;
    const { dir } = drag.current; drag.current.progress = progress;
    const w = props.pageWidth, segments = 64;
    let x = 0, z = 0; const points = [{ x: 0, z: 0 }];
    for (let i=0; i<segments; i++) {
      const u = (i+.5)/segments;
      const angle = progress * Math.PI + Math.sin(u * Math.PI) * Math.sin(progress * Math.PI) * .9;
      x += Math.cos(angle)*w/segments; z += Math.sin(angle)*w/segments;
      points.push({x,z});
    }
    const hinge = props.spread ? dir * 4 : dir * (progress - .5) * w;
    if (shadow.current) {
      shadow.current.style.opacity = String(Math.sin(progress * Math.PI) * .28);
      shadow.current.style.left = `${Math.max(0, Math.min(stageWidth, stageWidth / 2 + hinge + dir * pointForShadow(points)))}px`;
    }
    [s.front,s.back].forEach((mesh, side) => {
      const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
      for (let i=0;i<pos.count;i++) {
        const col = i % 65, row = Math.floor(i / 65), u = col / 64, point = points[col];
        pos.setXYZ(i, hinge + dir * point.x, props.height / 2 - row * props.height / 24, point.z + (side ? -.15 : .15));
        uv.setX(i, (side === 0) === (dir === 1) ? u : 1-u);
      }
      pos.needsUpdate=true; uv.needsUpdate=true; mesh.geometry.computeVertexNormals();
      (mesh.material as THREE.MeshStandardMaterial).side = dir === 1 ? (side ? THREE.BackSide : THREE.FrontSide) : (side ? THREE.FrontSide : THREE.BackSide);
    });
    s.renderer.render(s.scene,s.camera);
  }
  function begin(dir: number) {
    if (drag.current.active || !latest.current.canTurn(dir)) return false;
    const s = gl.current;
    if (!s) { latest.current.onTurn(dir); return false; }
    try {
      [s.front,s.back].forEach((mesh, i) => {
        const material = mesh.material as THREE.MeshStandardMaterial;
        const previous = material.map;
        const texture = new THREE.CanvasTexture(i ? latest.current.back(dir) : latest.current.front(dir));
        texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=Math.min(4,s.renderer.capabilities.getMaxAnisotropy());
        material.map=texture; material.needsUpdate=true; previous?.dispose();
      });
      drag.current={dir,progress:0,startX:0,moved:0,active:true,settling:false};
      latest.current.onActive(dir); setVisible(true); render(0); return true;
    } catch { latest.current.onError(); latest.current.onTurn(dir); return false; }
  }
  function settle(target: number) {
    if (!drag.current.active || drag.current.settling) return;
    drag.current.settling=true;
    const start=performance.now(), from=drag.current.progress, duration=Math.max(150, 420*Math.abs(target-from));
    const tick=(now:number) => {
      const t=Math.min(1,(now-start)/duration), eased=1-Math.pow(1-t,3);
      render(from+(target-from)*eased);
      if(t<1) frame.current=requestAnimationFrame(tick);
      else { const dir=drag.current.dir; drag.current.active=false; drag.current.settling=false; setVisible(false); latest.current.onActive(0); if(target===1) latest.current.onTurn(dir); }
    };
    cancelAnimationFrame(frame.current); frame.current=requestAnimationFrame(tick);
  }
  useImperativeHandle(ref, () => ({ turn(dir) { if(begin(dir)) settle(1); } }));
  return <div className="paper-flip-layer">
    <div ref={shadow} className="paper-flip-shadow" />
    <div ref={mount} className="paper-flip-canvas" style={{opacity:visible ? 1 : 0}} />
    {[-1,1].map(dir => <div key={dir} className={`paper-flip-handle ${dir===1 ? "right" : "left"}`} role="button" aria-label={dir===1 ? "拖动翻到下一页" : "拖动翻到上一页"}
      onPointerDown={e => { if(e.button!==0) return; if(begin(dir)) { e.currentTarget.setPointerCapture(e.pointerId); drag.current.startX=e.clientX; } }}
      onPointerMove={e => { if(!drag.current.active || drag.current.settling || !e.currentTarget.hasPointerCapture(e.pointerId)) return; const distance=(drag.current.startX-e.clientX)*dir; drag.current.moved=Math.max(drag.current.moved,Math.abs(distance)); render(Math.max(0,Math.min(1,distance/(props.pageWidth*1.15)))); }}
      onPointerUp={e => { if(!drag.current.active || !e.currentTarget.hasPointerCapture(e.pointerId)) return; e.currentTarget.releasePointerCapture(e.pointerId); settle(drag.current.moved<8 || drag.current.progress>.38 ? 1 : 0); }}
      onPointerCancel={() => settle(0)} />)}
  </div>;
});
function pointForShadow(points: {x:number; z:number}[]) { return points[points.length - 1].x; }
