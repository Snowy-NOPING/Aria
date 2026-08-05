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

/** Longest edge of the downscaled texture. Fewer pixels, softer wash. */
const TEXTURE_EDGE = 56;

/** How long a change of artwork takes to dissolve. */
const FADE_MS = 1200;

/** Cap on the render target. The image is a wash — resolution buys nothing. */
const MAX_WIDTH = 640;

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
uniform float uMix;
uniform float uTime;
uniform float uWarp;

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

/** Crop rather than squash: the wash must not stretch a square cover wide. */
vec2 cover(vec2 uv, vec2 scale) {
  return (uv - 0.5) * scale + 0.5;
}

void main() {
  vec2 p = vUv;

  // The warp field itself drifts, so the flow never settles into a pattern
  // that sits still on screen.
  vec2 warp = vec2(
    flow(vec3(p * 1.7, uTime * 0.075)),
    flow(vec3(p * 1.9 + 13.7, uTime * 0.061))
  ) * uWarp;
  vec2 drift = vec2(sin(uTime * 0.043), cos(uTime * 0.031)) * 0.055;

  vec2 uv = p + warp + drift;
  vec3 prev = texture(uPrev, cover(uv, uPrevCover)).rgb;
  vec3 next = texture(uNext, cover(uv, uNextCover)).rgb;
  vec3 col = mix(prev, next, uMix);

  // Downscaling averages colour together, which desaturates. Push it back.
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(luma), col, 1.22), 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}`;

export interface ArtworkField {
  /** Dissolve to a new artwork, or to nothing. Same source is a no-op. */
  setArtwork(src: string | null): void;
  /** True once something has been drawn — the canvas is blank before that. */
  readonly painted: () => boolean;
  destroy(): void;
}

interface Layer {
  tex: WebGLTexture;
  aspect: number;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("artwork field shader:", gl.getShaderInfoLog(shader));
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
  ctx.drawImage(img, 0, 0, tw, th);

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
  return { tex, aspect: tw / th };
}

/**
 * Start a field on `canvas`. Returns null when WebGL2 isn't available, which is
 * the caller's cue to fall back to a CSS wash.
 */
export function createArtworkField(canvas: HTMLCanvasElement): ArtworkField | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("artwork field link:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

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
    mix: gl.getUniformLocation(program, "uMix"),
    time: gl.getUniformLocation(program, "uTime"),
    warp: gl.getUniformLocation(program, "uWarp"),
  };
  gl.uniform1i(u.prev, 0);
  gl.uniform1i(u.next, 1);

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
    // Half density, capped: a warped wash of 56-pixel textures has no detail
    // that a higher resolution could show.
    const w = Math.max(2, Math.min(MAX_WIDTH, Math.round(rect.width * dpr * 0.5)));
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
    gl!.uniform1f(u.mix, mix);
    gl!.uniform1f(u.time, seconds);
    gl!.uniform1f(u.warp, 0.075);
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

  const observer = new ResizeObserver(() => schedule());
  observer.observe(canvas);

  return {
    painted: () => painted,

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
