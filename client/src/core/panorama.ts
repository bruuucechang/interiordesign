import * as THREE from 'three';

// 360° panorama capture. A CubeCamera grabs the scene as six faces, then a
// full-screen pass reprojects them into a single equirectangular image — the
// format Facebook, Kuula and every 720 viewer expects.

export const PANO_WIDTH = 4096;
export const PANO_HEIGHT = 2048;
const CUBE_FACE = 1024;            // ~PANO_WIDTH / 4 keeps detail without overkill

// three.js only applies tone mapping and sRGB encoding when it renders to the
// canvas; rendering into a render target hands back raw linear colour. The
// reprojection shader therefore has to reproduce both, or the panorama comes
// out looking nothing like the 3D view on screen.
const FRAG = /* glsl */`
  precision highp float;
  uniform samplerCube tCube;
  uniform float exposure;
  varying vec2 vUv;
  const float PI = 3.141592653589793;

  // ACES filmic approximation, matching THREE.ACESFilmicToneMapping closely
  // enough that the panorama reads the same as the viewport.
  vec3 aces(vec3 x) {
    const mat3 IN = mat3(0.59719, 0.07600, 0.02840,
                         0.35458, 0.90834, 0.13383,
                         0.04823, 0.01566, 0.83777);
    const mat3 OUT = mat3( 1.60475, -0.10208, -0.00327,
                          -0.53108,  1.10813, -0.07276,
                          -0.07367, -0.00605,  1.07602);
    x = IN * x;
    vec3 a = x * (x + 0.0245786) - 0.000090537;
    vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
    return clamp(OUT * (a / b), 0.0, 1.0);
  }

  void main() {
    // u spans a full turn, v spans pole to pole. -Z is forward, matching the
    // convention every equirectangular viewer assumes.
    float lon = (vUv.x - 0.5) * 2.0 * PI;
    float lat = (vUv.y - 0.5) * PI;
    vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
    vec3 c = textureCube(tCube, dir).rgb;
    c = aces(c * exposure);
    c = pow(c, vec3(1.0 / 2.2));               // linear → sRGB
    gl_FragColor = vec4(c, 1.0);
  }
`;

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

interface SavedMaterial { m: THREE.MeshPhysicalMaterial; transmission: number; transparent: boolean; opacity: number; }

/**
 * Swap physically-transmissive glass for plain alpha for the duration of a
 * capture.
 *
 * `transmission` needs its own backbuffer pass, which three.js cannot nest
 * inside a cube-face render: the whole face comes back solid black, not just
 * the glass. In this scene one window was enough to black out a quarter of
 * every panorama. Alpha is a close enough stand-in for a still image.
 */
function flattenTransmission(scene: THREE.Scene): SavedMaterial[] {
  const saved: SavedMaterial[] = [];
  scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mat of list) {
      const m = mat as THREE.MeshPhysicalMaterial;
      if (!(m.transmission > 0)) continue;
      saved.push({ m, transmission: m.transmission, transparent: m.transparent, opacity: m.opacity });
      m.transparent = true;
      if (m.opacity >= 1) m.opacity = Math.max(0.15, 1 - m.transmission * 0.7);
      m.transmission = 0;
      m.needsUpdate = true;
    }
  });
  return saved;
}

function restoreTransmission(saved: SavedMaterial[]) {
  for (const s of saved) {
    s.m.transmission = s.transmission;
    s.m.transparent = s.transparent;
    s.m.opacity = s.opacity;
    s.m.needsUpdate = true;
  }
}

/**
 * Render an equirectangular panorama of `scene` from `position` and return it
 * as a canvas. Restores every renderer and material setting it touches.
 */
export function capturePanorama(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, position: THREE.Vector3,
): HTMLCanvasElement {
  const cubeRT = new THREE.WebGLCubeRenderTarget(CUBE_FACE, {
    generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  cubeRT.texture.colorSpace = THREE.LinearSRGBColorSpace;   // keep it linear for the shader
  const cubeCam = new THREE.CubeCamera(1, 200000, cubeRT);
  cubeCam.position.copy(position);

  const outRT = new THREE.WebGLRenderTarget(PANO_WIDTH, PANO_HEIGHT, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });

  const quadScene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    uniforms: { tCube: { value: cubeRT.texture }, exposure: { value: renderer.toneMappingExposure } },
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const quadCam = new THREE.Camera();

  const prevTarget = renderer.getRenderTarget();
  const prevToneMapping = renderer.toneMapping;
  const savedMaterials = flattenTransmission(scene);
  try {
    // The cube pass must stay linear — the shader does the tone mapping.
    renderer.toneMapping = THREE.NoToneMapping;
    cubeCam.update(renderer, scene);

    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(outRT);
    renderer.render(quadScene, quadCam);

    const pixels = new Uint8Array(PANO_WIDTH * PANO_HEIGHT * 4);
    renderer.readRenderTargetPixels(outRT, 0, 0, PANO_WIDTH, PANO_HEIGHT, pixels);

    const canvas = document.createElement('canvas');
    canvas.width = PANO_WIDTH; canvas.height = PANO_HEIGHT;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(PANO_WIDTH, PANO_HEIGHT);
    // WebGL reads bottom-up; flip into the canvas's top-down rows.
    const rowBytes = PANO_WIDTH * 4;
    for (let y = 0; y < PANO_HEIGHT; y++) {
      const src = (PANO_HEIGHT - 1 - y) * rowBytes;
      img.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  } finally {
    restoreTransmission(savedMaterials);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevToneMapping;
    material.dispose();
    outRT.dispose();
    cubeRT.dispose();
  }
}

/**
 * A single self-contained HTML file: the panorama inlined as a data URI plus a
 * small WebGL viewer. Deliberately hand-written rather than bundling three.js,
 * which would add ~600 KB to something a client just double-clicks.
 */
export function panoramaViewerHTML(jpegDataUrl: string, title: string, initialYaw = 0): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · 360 全景</title>
<style>
  html,body{margin:0;height:100%;background:#111;overflow:hidden}
  canvas{display:block;width:100%;height:100%;cursor:grab}
  canvas.drag{cursor:grabbing}
  .hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);
        font:13px/1.6 system-ui,sans-serif;color:#fff;background:#0008;
        padding:6px 14px;border-radius:99px;pointer-events:none;transition:opacity .4s}
  .hint.gone{opacity:0}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div class="hint" id="hint">拖曳環顧 · 滾輪縮放</div>
<script>
const IMG = "${jpegDataUrl}";
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl');
const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}';
const FS = [
  'precision highp float;varying vec2 v;uniform sampler2D t;',
  'uniform float yaw,pitch,fov,aspect;const float PI=3.141592653589793;',
  'void main(){',
  '  float tf=tan(fov*.5);',
  '  vec3 d=normalize(vec3(v.x*tf*aspect, v.y*tf, -1.));',
  '  float cp=cos(pitch),sp=sin(pitch);',
  '  d=vec3(d.x, d.y*cp-d.z*sp, d.y*sp+d.z*cp);',
  '  float cy=cos(yaw),sy=sin(yaw);',
  '  d=vec3(d.x*cy+d.z*sy, d.y, -d.x*sy+d.z*cy);',
  '  float lon=atan(d.x,-d.z), lat=asin(clamp(d.y,-1.,1.));',
  '  gl_FragColor=texture2D(t, vec2(lon/(2.*PI)+.5, lat/PI+.5));',
  '}'
].join('\\n');
function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
const prog=gl.createProgram();
gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS));
gl.linkProgram(prog);gl.useProgram(prog);
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(prog,'p');gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
const U=n=>gl.getUniformLocation(prog,n);
let yaw=${initialYaw}, pitch=0, fov=1.2, ready=false;
const tex=gl.createTexture();
const im=new Image();
im.onload=()=>{
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,im);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  ready=true;draw();
};
im.src=IMG;
function resize(){
  const d=Math.min(window.devicePixelRatio||1,2);
  canvas.width=canvas.clientWidth*d;canvas.height=canvas.clientHeight*d;
  gl.viewport(0,0,canvas.width,canvas.height);
}
function draw(){
  if(!ready)return;
  gl.uniform1f(U('yaw'),yaw);gl.uniform1f(U('pitch'),pitch);
  gl.uniform1f(U('fov'),fov);gl.uniform1f(U('aspect'),canvas.width/canvas.height);
  gl.uniform1i(U('t'),0);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}
let dragging=false,lx=0,ly=0;
canvas.addEventListener('pointerdown',e=>{dragging=true;lx=e.clientX;ly=e.clientY;
  canvas.classList.add('drag');canvas.setPointerCapture(e.pointerId);
  document.getElementById('hint').classList.add('gone');});
canvas.addEventListener('pointermove',e=>{
  if(!dragging)return;
  yaw-=(e.clientX-lx)*0.0032;pitch+=(e.clientY-ly)*0.0032;
  pitch=Math.max(-1.5,Math.min(1.5,pitch));
  lx=e.clientX;ly=e.clientY;draw();});
const stop=e=>{dragging=false;canvas.classList.remove('drag');};
canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
canvas.addEventListener('wheel',e=>{e.preventDefault();
  fov=Math.max(0.35,Math.min(2.2,fov*(1+Math.sign(e.deltaY)*0.08)));draw();},{passive:false});
window.addEventListener('resize',()=>{resize();draw();});
resize();
</script>
</body>
</html>`;
}

/**
 * Is a shot from `pos` worth taking? The camera frames the building from
 * outside by default, and a panorama from out there is a picture of an empty
 * sky, so the export declines rather than hand back something useless.
 *
 * Plan coordinates (x, y) map to 3D (X, Z), and `ceiling` is the storey height.
 *
 * The height matters, which an earlier version said it did not — its reasoning
 * was that standing above the walls still looks down into the rooms. True for a
 * normal view, false for a full sphere: from the default framing the camera
 * sits above the plan, well clear of the walls, and its X/Z land inside the
 * bounding box, so the check passed and the export handed back a 4096×2048
 * image that was flat sky apart from one small patch of floor. Measured on a
 * 5×4 m room.
 */
export function isInsidePlan(
  pos: { x: number; y?: number; z: number },
  boxes: { x: number; y: number; w: number; h: number }[],
  ceiling?: number,
): boolean {
  if (ceiling !== undefined && pos.y !== undefined && pos.y > ceiling) return false;
  if (!boxes.length) return true;                     // nothing drawn — nothing to be outside of
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return pos.x >= minX && pos.x <= maxX && pos.z >= minY && pos.z <= maxY;
}

/** Download the panorama twice: the bare JPG for 720 platforms, and a viewer anyone can open. */
export function savePanorama(canvas: HTMLCanvasElement, yaw: number, name: string) {
  const base = (name || 'panorama').replace(/\.[a-z0-9]+$/i, '');
  const jpeg = canvas.toDataURL('image/jpeg', 0.88);
  download(jpeg, `${base}_360.jpg`);
  const html = panoramaViewerHTML(jpeg, base, yaw);
  download(URL.createObjectURL(new Blob([html], { type: 'text/html' })), `${base}_360.html`, true);
}

function download(url: string, filename: string, revoke = false) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  if (revoke) URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
