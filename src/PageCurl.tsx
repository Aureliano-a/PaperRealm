import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
export type CurlHandle = { turn: (dir: number) => void };
type Props = {
  width: number;
  height: number;
  front: (dir: number) => HTMLCanvasElement;
  back: (dir: number) => HTMLCanvasElement;
  canTurn: (dir: number) => boolean;
  onTurn: (dir: number) => void;
  onActive: (dir: number) => void;
  enabled: boolean;
  sound: boolean;
  onError: () => void;
};
export function curlPoint(u: number, p: number, width: number) {
  const n = 64;
  let x = 0,
    z = 0;
  for (let k = 0; k < Math.round(u * n); k++) {
    const t = (k + 0.5) / n;
    const a = p * Math.PI + Math.sin(t * Math.PI) * Math.sin(p * Math.PI) * 0.8;
    x += (Math.cos(a) * width) / n;
    z += (Math.sin(a) * width) / n;
  }
  return { x, z };
}
export default forwardRef<CurlHandle, Props>(function PageCurl(props, ref) {
  const mount = useRef<HTMLDivElement>(null),
    state = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      front: THREE.Mesh;
      back: THREE.Mesh;
      shadow: THREE.Mesh;
    } | null>(null),
    latest = useRef(props),
    drag = useRef({ dir: 1, p: 0, startX: 0, moved: 0, active: false }),
    raf = useRef(0),
    [active, setActive] = useState(false);
  latest.current = props;
  useEffect(() => {
    if (!props.enabled) return;
    try {
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(props.width * 2, props.height + 180);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      mount.current!.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        35,
        (props.width * 2) / (props.height + 180),
        1,
        10000,
      );
      camera.position.set(
        0,
        0,
        (props.height + 180) / (2 * Math.tan((35 * Math.PI) / 360)),
      );
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const light = new THREE.DirectionalLight(0xfff6e8, 0.8);
      light.position.set(-props.width * 0.8, props.height * 0.8, 1000);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.left = -props.width * 2;
      light.shadow.camera.right = props.width * 2;
      light.shadow.camera.top = props.height;
      light.shadow.camera.bottom = -props.height;
      light.shadow.camera.far = 4000;
      light.shadow.bias = -0.0005;
      scene.add(light);
      const geo = new THREE.PlaneGeometry(props.width, props.height, 64, 20);
      const front = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ side: THREE.FrontSide, roughness: 1 }),
      );
      const back = new THREE.Mesh(
        geo.clone(),
        new THREE.MeshStandardMaterial({ side: THREE.BackSide, roughness: 1 }),
      );
      front.castShadow = true;
      back.castShadow = true;
      scene.add(front, back);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(props.width * 2, props.height),
        new THREE.ShadowMaterial({ opacity: 0.23 }),
      );
      shadow.position.z = -3;
      shadow.receiveShadow = true;
      scene.add(shadow);
      state.current = { renderer, scene, camera, front, back, shadow };
      return () => {
        cancelAnimationFrame(raf.current);
        [front, back, shadow].forEach((m) => {
          m.geometry.dispose();
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.map?.dispose();
          mat.dispose();
        });
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        state.current = null;
      };
    } catch {
      latest.current.onError();
    }
  }, [props.width, props.height, props.enabled]);
  function render(p: number) {
    const s = state.current;
    if (!s) return;
    drag.current.p = p;
    const points = Array.from({ length: 65 }, (_, i) =>
      curlPoint(i / 64, p, props.width),
    );
    for (const [index, mesh] of [s.front, s.back].entries()) {
      const pos = mesh.geometry.attributes.position,
        uv = mesh.geometry.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const col = i % 65,
          u = col / 64,
          point = points[col],
          y = props.height / 2 - (Math.floor(i / 65) / 20) * props.height;
        pos.setXYZ(
          i,
          drag.current.dir * point.x,
          y,
          point.z + (index ? -0.2 : 0.2),
        );
        uv.setX(i, (index === 0) === (drag.current.dir === 1) ? u : 1 - u);
      }
      pos.needsUpdate = true;
      uv.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      (mesh.material as THREE.MeshStandardMaterial).side =
        drag.current.dir === 1
          ? index
            ? THREE.BackSide
            : THREE.FrontSide
          : index
            ? THREE.FrontSide
            : THREE.BackSide;
    }
    s.renderer.render(s.scene, s.camera);
  }
  function begin(dir: number) {
    if (drag.current.active || !latest.current.canTurn(dir)) return false;
    if (!latest.current.enabled || !state.current) {
      latest.current.onTurn(dir);
      return false;
    }
    drag.current = { dir, p: 0, startX: 0, moved: 0, active: true };
    const s = state.current;
    [s.front, s.back].forEach((mesh, i) => {
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.map?.dispose();
      m.map = new THREE.CanvasTexture(
        i ? latest.current.back(dir) : latest.current.front(dir),
      );
      m.map.colorSpace = THREE.SRGBColorSpace;
      m.needsUpdate = true;
    });
    setActive(true);
    latest.current.onActive(dir);
    render(0);
    return true;
  }
  function animate(target: number) {
    const start = performance.now(),
      from = drag.current.p;
    const tick = (now: number) => {
      const t = Math.min(
        1,
        (now - start) / Math.max(140, 360 * Math.abs(target - from)),
      );
      render(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else {
        drag.current.active = false;
        setActive(false);
        latest.current.onActive(0);
        if (target === 1) {
          latest.current.onTurn(drag.current.dir);
          if (latest.current.sound) playFlip();
        }
      }
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  }
  useImperativeHandle(ref, () => ({
    turn(dir) {
      if (begin(dir)) animate(1);
    },
  }));
  return (
    <div className="curl-layer">
      <div
        ref={mount}
        className="curl-canvas"
        style={{ opacity: active ? 1 : 0 }}
      />
      {[-1, 1].map((dir) => (
        <div
          key={dir}
          role="button"
          aria-label={dir === 1 ? "拖动下一页" : "拖动上一页"}
          className={"curl-handle " + (dir === 1 ? "right" : "left")}
          onPointerDown={(e) => {
            if (begin(dir)) {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current.startX = e.clientX;
            }
          }}
          onPointerMove={(e) => {
            if (
              drag.current.active &&
              e.currentTarget.hasPointerCapture(e.pointerId)
            ) {
              const distance = (drag.current.startX - e.clientX) * dir;
              drag.current.moved = Math.max(
                drag.current.moved,
                Math.abs(distance),
              );
              render(Math.max(0, Math.min(1, distance / (props.width * 1.45))));
            }
          }}
          onPointerUp={(e) => {
            if (
              drag.current.active &&
              e.currentTarget.hasPointerCapture(e.pointerId)
            ) {
              e.currentTarget.releasePointerCapture(e.pointerId);
              animate(drag.current.moved < 8 || drag.current.p > 0.38 ? 1 : 0);
            }
          }}
          onPointerCancel={() => {
            if (drag.current.active) animate(0);
          }}
        />
      ))}
    </div>
  );
});
let audio: AudioContext | undefined;
function playFlip() {
  try {
    audio ??= new AudioContext();
    const buffer = audio.createBuffer(
        1,
        audio.sampleRate * 0.16,
        audio.sampleRate,
      ),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * 0.06 * (1 - i / data.length);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.start();
  } catch {
    /* Audio is optional. */
  }
}
