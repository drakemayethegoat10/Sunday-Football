// PS2-style render pipeline:
//   1. Render the 3D scene into a small fixed-size target (640x448 by default, the PS2's
//      common framebuffer size). The camera keeps the screen's aspect ratio, so on a
//      widescreen display the pixels are slightly wide (anamorphic), like PS2 widescreen.
//   2. Bright-pass + downsample, then a separable blur for a soft bloom on highlights.
//   3. Composite onto the full-size canvas with bilinear upscaling, a light vignette and a
//      touch of dithering to hide banding.

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tDiffuse, vUv + o * texel).rgb; }
void main() {
  // 4 bilinear taps = a 4x4 box filter, so the 4x downsample doesn't shimmer.
  vec3 c = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  float knee = 0.18;
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, l - threshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270;
  s += texture2D(tDiffuse, vUv + dir * 1.3846154).rgb * 0.3162162;
  s += texture2D(tDiffuse, vUv - dir * 1.3846154).rgb * 0.3162162;
  s += texture2D(tDiffuse, vUv + dir * 3.2307692).rgb * 0.0702703;
  s += texture2D(tDiffuse, vUv - dir * 3.2307692).rgb * 0.0702703;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float bloomStrength;
uniform vec2 resolution;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  col += bloom * bloomStrength;
  // Slightly punchier color, like a CRT-era console image.
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.12);
  // Soft vignette.
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.42;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <colorspace_fragment>
  // Ordered-ish dither (in output space) to hide 8-bit banding in the sky and fog.
  gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
}`;

function rt(w: number, h: number, srgb: boolean, depth: boolean): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  if (srgb) t.texture.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Ps2Pipeline {
  private sceneRT: THREE.WebGLRenderTarget;
  private bloomA: THREE.WebGLRenderTarget;
  private bloomB: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private bright: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private composite: THREE.ShaderMaterial;
  width = 640;
  height = 448;
  bloomStrength = 0.6;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.sceneRT = rt(this.width, this.height, true, true);
    this.bloomA = rt(this.width / 4, this.height / 4, false, false);
    this.bloomB = rt(this.width / 4, this.height / 4, false, false);
    this.bright = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.72 } },
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tBloom: { value: this.bloomA.texture },
        bloomStrength: { value: this.bloomStrength },
        resolution: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Internal 3D resolution. `null` = match the canvas (native). */
  setInternalSize(size: [number, number] | null) {
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const [w, h] = size ?? [Math.max(2, buf.x), Math.max(2, buf.y)];
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.sceneRT.setSize(w, h);
    const bw = Math.max(2, Math.round(w / 4));
    const bh = Math.max(2, Math.round(h / 4));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);

    const bw = this.bloomA.width;
    const bh = this.bloomA.height;
    this.bright.uniforms.tDiffuse.value = this.sceneRT.texture;
    this.bright.uniforms.texel.value.set(1 / this.width, 1 / this.height);
    this.pass(this.bright, this.bloomA);
    for (const spread of [1, 2]) {
      this.blur.uniforms.tDiffuse.value = this.bloomA.texture;
      this.blur.uniforms.dir.value.set(spread / bw, 0);
      this.pass(this.blur, this.bloomB);
      this.blur.uniforms.tDiffuse.value = this.bloomB.texture;
      this.blur.uniforms.dir.value.set(0, spread / bh);
      this.pass(this.blur, this.bloomA);
    }

    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    this.composite.uniforms.resolution.value.copy(buf);
    this.composite.uniforms.bloomStrength.value = this.bloomStrength;
    this.pass(this.composite, null);
  }
}
