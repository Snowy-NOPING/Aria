/**
 * The artwork colour field, on the GPU.
 *
 * Three ideas stacked, none of them a blur filter:
 *
 * 1. **Extreme downscale is the blur.** The cover is drawn into a canvas a few
 *    dozen pixels wide and uploaded as a texture with linear filtering. Scaling
 *    those handful of pixels back up to the window *is* the softening — the
 *    hardware interpolates between them for free. A real gaussian over a
 *    full-size image costs orders of magnitude more for a blurrier result.
 * 2. **A noise warp is the motion.** A static wash reads as a photo behind
 *    glass. Displacing the texture coordinates with value noise that evolves
 *    over time makes the colours flow into each other instead.
 * 3. **Two textures are the crossfade.** The outgoing artwork stays resident
 *    while the incoming one loads, and the shader mixes between them, so a
 *    track change dissolves rather than cuts.
 *
 * Everything is sampled through the same warped coordinate, so the two
 * artworks flow as one field rather than as two images fading past each other.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Longest edge of the downscaled texture, and the single control over how much
 * of the cover you can still read. 128 keeps its composition legible — a window
 * stays a window, a horizon stays a horizon — which is a magnified photograph,
 * not a colour field. At 44 nothing survives but where the colours sat.
 *
 * The reason this can go low is the bicubic sampling below. Bilinear creases
 * along every texel boundary, so a small texture used to facet, which is what
 * forced this up in the first place; a cubic spline is smooth across them.
 */
const TEXTURE_EDGE = 44;

/** How long a change of artwork takes to dissolve. */
const FADE_MS = 1200;

/**
 * Cap on the render target. The wash carries no detail, but it does carry wide
 * smooth gradients, and those are exactly what shows every missing pixel once
 * the browser stretches the canvas back up. Rendering at native density and
 * letting this cap bite only on very large windows costs almost nothing — the
 * shader is a handful of instructions per pixel.
 */
const MAX_WIDTH = 1920;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrev;
uniform sampler2D uNext;
uniform vec2 uPrevCover;
uniform vec2 uNextCover;
uniform vec2 uPrevSize;
uniform vec2 uNextSize;
uniform float uMix;
uniform float uTime;
uniform float uWarp;
uniform float uBrightness;

// Value noise: a hash at each lattice point, smoothstepped between. Cheaper
// than simplex and indistinguishable once it is only being used to nudge
// texture coordinates around.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

/** Two octaves, centred on zero so the warp pulls both ways. */
float flow(vec3 p) {
  return (noise(p) * 0.66 + noise(p * 2.13 + 4.7) * 0.34) * 2.0 - 1.0;
}

/**
 * Crop rather than squash: the wash must not stretch a square cover wide. The
 * extra factor pushes in past the edges of the art, so the frame holds a
 * region of colour rather than a whole picture with its composition intact.
 */
vec2 cover(vec2 uv, vec2 scale) {
  return (uv - 0.5) * scale * 0.62 + 0.5;
}

/** Cubic B-spline weights for the four texels around a sample point. */
vec4 splineWeights(float t) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - t;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}

/**
 * Bicubic sampling, as four bilinear taps rather than sixteen point reads: each
 * tap is placed off-centre so the hardware's own interpolation does half the
 * work. This is the difference between a soft image and a blocky one at this
 * magnification — stretching a 128px texture across a window with plain
 * bilinear filtering creases along every texel boundary, and those creases read
 * as facets. A cubic spline is smooth across them.
 */
vec3 sampleSmooth(sampler2D tex, vec2 uv, vec2 size) {
  vec2 coord = uv * size - 0.5;
  vec2 f = fract(coord);
  coord -= f;

  vec4 wx = splineWeights(f.x);
  vec4 wy = splineWeights(f.y);
  vec4 sums = vec4(wx.xz + wx.yw, wy.xz + wy.yw);
  vec4 taps = coord.xxyy + vec2(-0.5, 1.5).xyxy + vec4(wx.yw, wy.yw) / sums;
  taps /= size.xxyy;

  vec3 a = texture(tex, taps.xz).rgb;
  vec3 b = texture(tex, taps.yz).rgb;
  vec3 c = texture(tex, taps.xw).rgb;
  vec3 d = texture(tex, taps.yw).rgb;

  float mx = sums.x / (sums.x + sums.y);
  float my = sums.z / (sums.z + sums.w);
  return mix(mix(d, c, mx), mix(b, a, mx), my);
}

void main() {
  vec2 p = vUv;

  // The warp field itself drifts, so the flow never settles into a pattern
  // that sits still on screen. Large enough to fold the image through itself:
  // a small displacement of a recognisable picture reads as a wobble, and only
  // once the fold is bigger than the features does it read as liquid.
  vec2 warp = vec2(
    flow(vec3(p * 1.35, uTime * 0.075)),
    flow(vec3(p * 1.55 + 13.7, uTime * 0.061))
  ) * uWarp;
  vec2 drift = vec2(sin(uTime * 0.043), cos(uTime * 0.031)) * 0.07;

  vec2 uv = p + warp + drift;
  vec3 prev = sampleSmooth(uPrev, cover(uv, uPrevCover), uPrevSize);
  vec3 next = sampleSmooth(uNext, cover(uv, uNextCover), uNextSize);

  // Blend where light actually adds up. Crossfading sRGB values directly dips
  // through a muddy grey halfway between two colours; going linear first keeps
  // the dissolve luminous.
  vec3 col = mix(prev * prev, next * next, uMix);
  col = sqrt(col);

  // Downscaling averages colour together, which desaturates. Push it back.
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(luma), col, 1.22), 0.0, 1.0);

  // Applied here rather than as a CSS filter on the canvas: darkening after the
  // dither would scale the dither below one 8-bit step and the banding it was
  // added to hide would come straight back.
  col *= uBrightness;

  // A window-wide gradient crosses hundreds of pixels per 8-bit step, so it
  // bands into visible stripes. A sub-step of noise per pixel breaks the step
  // edges up and the eye reads the average — the single biggest difference
  // between this looking cheap and looking smooth.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}`;

/**
 * Ask, at startup, whether the field can run at all — without waiting for a
 * track to play. The same context and the same shaders as the real thing, on a
 * throwaway canvas, so a `no-webgl2` here means exactly what it says.
 */
export function probeArtworkField() {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  // Attached, not detached: a canvas in the document is composited with the
  // window, and that is the arrangement a context can be refused for. A
  // detached one can report success for a situation that never happens.
  canvas.style.cssText =
    "position:fixed;left:0;top:0;width:8px;height:8px;opacity:0;pointer-events:none";
  document.body.appendChild(canvas);

  // The real constructor: same attributes, same shaders, same link. A null here
  // has already reported why.
  const field = createArtworkField(canvas);
  if (!field) {
    canvas.remove();
    return;
  }

  // Creating a context proves nothing about painting with it, and the steps in
  // between — decoding a data URI, drawing it down, uploading it, running the
  // program — are exactly where a working GPU can still produce a blank window.
  // So: push a known colour through the whole path and read it back.
  const red = document.createElement("canvas");
  red.width = red.height = 8;
  const redCtx = red.getContext("2d");
  if (!redCtx) {
    field.destroy();
    canvas.remove();
    return;
  }
  redCtx.fillStyle = "#ff0000";
  redCtx.fillRect(0, 0, 8, 8);

  field.setArtwork(red.toDataURL());
  window.setTimeout(() => {
    const px = field.sampleCentre();
    const painted = !!px && px[0] > px[1] + 20 && px[0] > 40;
    reportStatus(
      painted ? "painting" : "blank",
      `${rendererName} · centre pixel rgb(${px?.join(", ") ?? "none"})`,
    );
    field.destroy();
    canvas.remove();
  }, 600);
}

export interface ArtworkField {
  /** Dissolve to a new artwork, or to nothing. Same source is a no-op. */
  setArtwork(src: string | null): void;
  /** True once something has been drawn — the canvas is blank before that. */
  readonly painted: () => boolean;
  /**
   * Draw a frame and read the centre pixel straight back out. Only the
   * self-test uses this: the drawing buffer isn't preserved across frames, so
   * the read has to happen in the same call as the draw.
   */
  sampleCentre(): [number, number, number] | null;
  destroy(): void;
}

interface Layer {
  tex: WebGLTexture;
  aspect: number;
  /** Texel dimensions, which the bicubic taps are positioned in. */
  width: number;
  height: number;
}

let lastShaderLog = "";
/** Filled in by the first successful context, for the diagnostic line. */
let rendererName = "unknown renderer";

/**
 * Record why the field did or didn't start. A backdrop that quietly falls back
 * to the CSS wash looks like a badly tuned shader rather than an absent one, and
 * there's no console to read in a packaged window — so the answer goes to disk
 * beside the rest of the app's state.
 */
const log: { state: string; detail: string; at: string }[] = [];

export function reportStatus(state: string, detail: string) {
  // A log, not a single line: the interesting case is a sequence — the probe
  // succeeding, the window's field going live, and then the immersive one
  // giving up — and only the last of those survives a single-value file.
  log.push({ state, detail, at: new Date().toISOString() });
  if (log.length > 16) log.shift();
  void invoke("save_data", { key: "fieldStatus", value: log }).catch(() => {
    /* diagnostics are never worth failing over */
  });
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    lastShaderLog = gl.getShaderInfoLog(shader) ?? "compile failed";
    console.error("artwork field shader:", lastShaderLog);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Draw `src` into a tiny canvas and upload it. Returns null if the image can't
 * be loaded or is cross-origin without CORS, in which case the canvas would be
 * tainted and the upload would throw.
 */
async function loadLayer(
  gl: WebGL2RenderingContext,
  src: string,
): Promise<Layer | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image failed to load"));
      img.src = src;
    });
  } catch {
    return null;
  }

  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const scale = TEXTURE_EDGE / Math.max(w, h);
  const tw = Math.max(2, Math.round(w * scale));
  const th = Math.max(2, Math.round(h * scale));

  const small = document.createElement("canvas");
  small.width = tw;
  small.height = th;
  const ctx = small.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Halve repeatedly rather than dropping 1000px to 128 in one call: a single
  // large downscale samples a sparse grid of the source and drops most of it,
  // which is where the crunchy, aliased look comes from. Each halving averages
  // every pixel it consumes, so the colour that arrives is the true average.
  let stepW = w;
  let stepH = h;
  let stage: HTMLCanvasElement | HTMLImageElement = img;
  while (stepW > tw * 2 && stepH > th * 2) {
    stepW = Math.max(tw, Math.round(stepW / 2));
    stepH = Math.max(th, Math.round(stepH / 2));
    const half = document.createElement("canvas");
    half.width = stepW;
    half.height = stepH;
    const halfCtx = half.getContext("2d");
    if (!halfCtx) break;
    halfCtx.imageSmoothingEnabled = true;
    halfCtx.imageSmoothingQuality = "high";
    halfCtx.drawImage(stage, 0, 0, stepW, stepH);
    stage = half;
  }
  ctx.drawImage(stage, 0, 0, tw, th);

  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // The warp samples past the edges; clamping holds the border colour there
  // instead of wrapping the opposite side of the cover into frame.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
  } catch (e) {
    console.error("artwork field upload:", e);
    gl.deleteTexture(tex);
    return null;
  }
  return { tex, aspect: tw / th, width: tw, height: th };
}

/**
 * Start a field on `canvas`. Returns null when WebGL2 isn't available, which is
 * the caller's cue to fall back to a CSS wash.
 */
export function createArtworkField(
  canvas: HTMLCanvasElement,
  onLost?: () => void,
): ArtworkField | null {
  // Preferred attributes first, then bare. An opaque drawing buffer and a
  // low-power hint are worth asking for, but not worth losing the field over if
  // this particular compositor refuses the combination.
  const gl =
    canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    }) ?? canvas.getContext("webgl2");
  if (!gl) {
    const one = canvas.getContext("webgl") ? "webgl1 available" : "no webgl at all";
    reportStatus("no-webgl2", `getContext('webgl2') returned null (${one})`);
    return null;
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !program) {
    reportStatus("shader", lastShaderLog || "shader compile failed");
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "link failed";
    console.error("artwork field link:", log);
    reportStatus("link", log);
    gl.deleteProgram(program);
    return null;
  }
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  rendererName = String(
    (debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? "",
  );
  reportStatus("ok", rendererName);

  // One triangle covering the clip space — no index buffer, no quad seam.
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.useProgram(program);
  const u = {
    prev: gl.getUniformLocation(program, "uPrev"),
    next: gl.getUniformLocation(program, "uNext"),
    prevCover: gl.getUniformLocation(program, "uPrevCover"),
    nextCover: gl.getUniformLocation(program, "uNextCover"),
    prevSize: gl.getUniformLocation(program, "uPrevSize"),
    nextSize: gl.getUniformLocation(program, "uNextSize"),
    mix: gl.getUniformLocation(program, "uMix"),
    time: gl.getUniformLocation(program, "uTime"),
    warp: gl.getUniformLocation(program, "uWarp"),
    brightness: gl.getUniformLocation(program, "uBrightness"),
  };
  gl.uniform1i(u.prev, 0);
  gl.uniform1i(u.next, 1);

  // The same token the CSS wash used, so the field keeps the luminance the rest
  // of the window's contrast was tuned against. Read once: it's a static theme
  // token, not something that changes while the app runs.
  const declared = parseFloat(
    getComputedStyle(canvas).getPropertyValue("--dynamic-bg-brightness"),
  );
  const brightness = Number.isFinite(declared) ? declared / 100 : 0.58;

  const stillness = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  let prev: Layer | null = null;
  let next: Layer | null = null;
  let fadeFrom = 0;
  let source: string | null = null;
  let generation = 0;
  let frame = 0;
  let painted = false;
  let destroyed = false;

  function sizeToCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Native density up to the cap. Below it the browser stretches the canvas
    // back up, and a bilinear upscale of an already-smooth gradient is where
    // the softness turns into visible mush.
    const w = Math.max(2, Math.min(MAX_WIDTH, Math.round(rect.width * dpr)));
    const h = Math.max(2, Math.round((rect.height / Math.max(1, rect.width)) * w));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl!.viewport(0, 0, w, h);
    }
  }

  /** Sub-rect of the texture that fills the canvas without distorting it. */
  function coverScale(texAspect: number): [number, number] {
    const canvasAspect = canvas.width / Math.max(1, canvas.height);
    return canvasAspect > texAspect
      ? [1, texAspect / canvasAspect]
      : [canvasAspect / texAspect, 1];
  }

  function render(now: number) {
    frame = 0;
    if (destroyed || !next) return;
    sizeToCanvas();

    const raw = fadeFrom ? Math.min(1, (now - fadeFrom) / FADE_MS) : 1;
    const mix = raw * raw * (3 - 2 * raw);
    const seconds = stillness?.matches ? 0 : now / 1000;

    const active = prev ?? next;
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, active.tex);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, next.tex);
    gl!.uniform2fv(u.prevCover, coverScale(active.aspect));
    gl!.uniform2fv(u.nextCover, coverScale(next.aspect));
    gl!.uniform2f(u.prevSize, active.width, active.height);
    gl!.uniform2f(u.nextSize, next.width, next.height);
    gl!.uniform1f(u.mix, mix);
    gl!.uniform1f(u.time, seconds);
    gl!.uniform1f(u.warp, 0.17);
    gl!.uniform1f(u.brightness, brightness);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    painted = true;

    if (raw >= 1) {
      // The outgoing artwork has finished dissolving; let it go.
      if (prev) {
        gl!.deleteTexture(prev.tex);
        prev = null;
      }
      fadeFrom = 0;
    }
    // A frozen field still needs redrawing while a crossfade is in flight.
    if (!stillness?.matches || fadeFrom) schedule();
  }

  function schedule() {
    if (destroyed || frame || document.hidden) return;
    frame = requestAnimationFrame(render);
  }

  function onVisibility() {
    if (!document.hidden) schedule();
  }
  document.addEventListener("visibilitychange", onVisibility);

  // A driver reset or a GPU switch takes the context away and leaves a frozen
  // canvas behind. Preventing the default keeps the canvas restorable, and the
  // owner is told so it can build a fresh field on it.
  function onContextLost(e: Event) {
    e.preventDefault();
    destroyed = true;
    if (frame) cancelAnimationFrame(frame);
    reportStatus("lost", "webglcontextlost");
    onLost?.();
  }
  canvas.addEventListener("webglcontextlost", onContextLost);

  const observer = new ResizeObserver(() => schedule());
  observer.observe(canvas);

  return {
    painted: () => painted,

    sampleCentre() {
      if (destroyed || !next) return null;
      render(performance.now());
      const px = new Uint8Array(4);
      gl.readPixels(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        px,
      );
      return [px[0], px[1], px[2]];
    },

    setArtwork(src: string | null) {
      if (src === source) return;
      source = src;
      const mine = ++generation;
      if (!src) return;

      void loadLayer(gl, src).then((layer) => {
        // A newer artwork arrived while this one was decoding, or the field is
        // already gone: the texture would only be leaked into a dead context.
        if (!layer) return;
        if (destroyed || mine !== generation) {
          gl.deleteTexture(layer.tex);
          return;
        }
        if (next) {
          if (prev) gl.deleteTexture(prev.tex);
          prev = next;
          fadeFrom = performance.now();
        }
        next = layer;
        schedule();
      });
    },

    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      if (prev) gl.deleteTexture(prev.tex);
      if (next) gl.deleteTexture(next.tex);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      // Contexts are a scarce resource and several of these can exist at once;
      // dropping it explicitly beats waiting for a collection.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
