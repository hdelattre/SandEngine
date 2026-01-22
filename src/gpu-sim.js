// @ts-check

import { DEFAULT_AMBIENT_TEMP } from "./particles.js";
import { CLEAR_FRAG, FULLSCREEN_VERT, HEAT_FRAG, MATTER_FRAG, PAINT_FRAG, RENDER_FRAG, STAMP_FRAG } from "./shaders.js";
import {
  createFramebufferForTextures,
  createFullscreenVao,
  createProgram,
  createRgba8Texture,
  createRgba8uiTexture,
  mustGetUniform,
} from "./webgl.js";

/** @typedef {import('./types.js').ParticleDef} ParticleDef */
/** @typedef {import('./types.js').ViewMode} ViewMode */
/** @typedef {import('./types.js').GpuSimOptions} GpuSimOptions */

/**
 * @param {number} n
 * @returns {number}
 */
function clampByte(n) {
  return n < 0 ? 0 : n > 255 ? 255 : n | 0;
}

export class GpuSim {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {ParticleDef[]} particleDefs
   * @param {Uint8Array} paletteTexels
   * @param {Uint8Array} propTexels
   * @param {Uint8Array} thermal0Texels
   * @param {Uint8Array} thermal1Texels
   * @param {Uint8Array} latentTexels
   * @param {GpuSimOptions} opts
   */
  constructor(canvas, particleDefs, paletteTexels, propTexels, thermal0Texels, thermal1Texels, latentTexels, opts) {
    /** @type {WebGL2RenderingContext | null} */
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.canvas = canvas;
    this.particleDefs = particleDefs;

    this.ambientTemp = DEFAULT_AMBIENT_TEMP;
    this.tick = 0;
    this.seed = opts.seed >>> 0;
    this.viewMode = /** @type {ViewMode} */ ("material");
    this.camCenterX = 0.5;
    this.camCenterY = 0.5;
    this.camZoom = 1.0;
    this.golEnabled = false;
    this.golInterval = 1;
    this.caEnabled = false;
    this.caInterval = 1;
    this.caRule = 30;
    this.caPaintId = 1;
    this.caSeedX = (opts.width >> 1) | 0;
    this.caSeedY = Math.max(1, (opts.height | 0) - 2);
    this.caGen = 0;
    this.caHasSeed = true;
    /** @type {null | {program: WebGLProgram, u: Record<string, WebGLUniformLocation>}} */
    this._gol = null;
    /** @type {Promise<void> | null} */
    this._golLoading = null;
    /** @type {null | {program: WebGLProgram, u: Record<string, WebGLUniformLocation>}} */
    this._caUpdate = null;
    /** @type {null | {program: WebGLProgram, u: Record<string, WebGLUniformLocation>}} */
    this._caApply = null;
    /** @type {Promise<void> | null} */
    this._caLoading = null;
    this._caTex = /** @type {[WebGLTexture | null, WebGLTexture | null]} */ ([null, null]);
    this._caFb = /** @type {[WebGLFramebuffer | null, WebGLFramebuffer | null]} */ ([null, null]);
    this._caFront = 0;
    this._caWidth = 0;

    this._vao = createFullscreenVao(gl);

    // Programs.
    this._heat = this._createHeatProgram();
    this._clear = this._createClearProgram();
    this._matter = this._createMatterProgram();
    this._paint = this._createPaintProgram();
    this._stamp = this._createStampProgram();
    this._render = this._createRenderProgram();

    // Constant textures.
    this._paletteTex = createRgba8Texture(gl, { width: 256, height: 1, data: paletteTexels });
    this._propTex = createRgba8uiTexture(gl, { width: 256, height: 1, data: propTexels });
    this._thermal0Tex = createRgba8uiTexture(gl, { width: 256, height: 1, data: thermal0Texels });
    this._thermal1Tex = createRgba8uiTexture(gl, { width: 256, height: 1, data: thermal1Texels });
    this._latentTex = createRgba8uiTexture(gl, { width: 256, height: 1, data: latentTexels });

    this._imgTex = gl.createTexture();
    if (!this._imgTex) throw new Error("createTexture failed");
    gl.bindTexture(gl.TEXTURE_2D, this._imgTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._imgSize = { width: 0, height: 0 };

    this._stateTex = /** @type {[WebGLTexture, WebGLTexture]} */ ([null, null]);
    this._energyTex = /** @type {[WebGLTexture, WebGLTexture]} */ ([null, null]);
    this._worldFb = /** @type {[WebGLFramebuffer, WebGLFramebuffer]} */ ([null, null]);
    this._front = 0;

    this.setWorldSize(opts.width, opts.height);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
  }

  /**
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createHeatProgram() {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, HEAT_FRAG);
    return {
      program,
      u: {
        state: mustGetUniform(gl, program, "u_state"),
        energy: mustGetUniform(gl, program, "u_energy"),
        props: mustGetUniform(gl, program, "u_props"),
        thermal0: mustGetUniform(gl, program, "u_thermal0"),
        latent: mustGetUniform(gl, program, "u_latent"),
        size: mustGetUniform(gl, program, "u_size"),
        dir: mustGetUniform(gl, program, "u_dir"),
        parity: mustGetUniform(gl, program, "u_parity"),
      },
    };
  }

  /**
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createClearProgram() {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, CLEAR_FRAG);
    return {
      program,
      u: {
        size: mustGetUniform(gl, program, "u_size"),
        ambientTemp: mustGetUniform(gl, program, "u_ambientTemp"),
        thermal0: mustGetUniform(gl, program, "u_thermal0"),
        thermal1: mustGetUniform(gl, program, "u_thermal1"),
        latent: mustGetUniform(gl, program, "u_latent"),
      },
    };
  }

  /**
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createMatterProgram() {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, MATTER_FRAG);
    return {
      program,
      u: {
        state: mustGetUniform(gl, program, "u_state"),
        energy: mustGetUniform(gl, program, "u_energy"),
        props: mustGetUniform(gl, program, "u_props"),
        thermal0: mustGetUniform(gl, program, "u_thermal0"),
        thermal1: mustGetUniform(gl, program, "u_thermal1"),
        latent: mustGetUniform(gl, program, "u_latent"),
        size: mustGetUniform(gl, program, "u_size"),
        dir: mustGetUniform(gl, program, "u_dir"),
        parity: mustGetUniform(gl, program, "u_parity"),
        tick: mustGetUniform(gl, program, "u_tick"),
        seed: mustGetUniform(gl, program, "u_seed"),
        selfStep: mustGetUniform(gl, program, "u_selfStep"),
        doMove: mustGetUniform(gl, program, "u_doMove"),
        ambientTemp: mustGetUniform(gl, program, "u_ambientTemp"),
        passSalt: mustGetUniform(gl, program, "u_passSalt"),
      },
    };
  }

  /**
   * @param {string} frag
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createGolProgram(frag) {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, frag);
    return {
      program,
      u: {
        state: mustGetUniform(gl, program, "u_state"),
        energy: mustGetUniform(gl, program, "u_energy"),
        thermal0: mustGetUniform(gl, program, "u_thermal0"),
        thermal1: mustGetUniform(gl, program, "u_thermal1"),
        latent: mustGetUniform(gl, program, "u_latent"),
        size: mustGetUniform(gl, program, "u_size"),
        seed: mustGetUniform(gl, program, "u_seed"),
        tick: mustGetUniform(gl, program, "u_tick"),
      },
    };
  }

  /**
   * Lazy-loads + compiles the GoL shader program, and toggles whether it runs per tick.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setGolEnabled(enabled) {
    if (!enabled) {
      this.golEnabled = false;
      return;
    }
    if (this._gol) {
      this.golEnabled = true;
      return;
    }

    if (!this._golLoading) {
      this._golLoading = (async () => {
        try {
          const mod = await import("./shaders-gol.js");
          this._gol = this._createGolProgram(mod.GOL_FRAG);
        } finally {
          // Allow retry on failure.
          this._golLoading = null;
        }
      })();
    }

    await this._golLoading;
    if (!this._gol) throw new Error("GoL program failed to initialize");
    this.golEnabled = true;
  }

  /**
   * @param {string} frag
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createCaUpdateProgram(frag) {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, frag);
    return {
      program,
      u: {
        ca: mustGetUniform(gl, program, "u_ca"),
        width: mustGetUniform(gl, program, "u_width"),
        rule: mustGetUniform(gl, program, "u_rule"),
      },
    };
  }

  /**
   * @param {string} frag
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createCaApplyProgram(frag) {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, frag);
    return {
      program,
      u: {
        state: mustGetUniform(gl, program, "u_state"),
        energy: mustGetUniform(gl, program, "u_energy"),
        ca: mustGetUniform(gl, program, "u_ca"),
        thermal0: mustGetUniform(gl, program, "u_thermal0"),
        thermal1: mustGetUniform(gl, program, "u_thermal1"),
        latent: mustGetUniform(gl, program, "u_latent"),
        size: mustGetUniform(gl, program, "u_size"),
        ambientTemp: mustGetUniform(gl, program, "u_ambientTemp"),
        paintId: mustGetUniform(gl, program, "u_paintId"),
        emitY: mustGetUniform(gl, program, "u_emitY"),
      },
    };
  }

  _ensureCaBuffers() {
    const gl = this.gl;
    const w = this.width | 0;
    if (w <= 0) return;
    if (this._caTex[0] && this._caWidth === w) return;

    for (let i = 0; i < 2; i++) {
      if (this._caTex[i]) gl.deleteTexture(this._caTex[i]);
      if (this._caFb[i]) gl.deleteFramebuffer(this._caFb[i]);
      this._caTex[i] = null;
      this._caFb[i] = null;
    }

    const init = new Uint8Array(w * 4);
    const minX = w >= 3 ? 1 : 0;
    const maxX = w >= 3 ? w - 2 : w - 1;
    const wantX = this.caHasSeed ? (this.caSeedX | 0) : (w >> 1);
    const cx = Math.max(minX, Math.min(maxX, wantX));
    init[cx * 4 + 0] = 1;
    this.caSeedX = cx;
    const h = this.height | 0;
    const minY = h >= 2 ? 1 : 0;
    const maxY = h >= 3 ? h - 2 : h - 1;
    if (!this.caHasSeed) {
      this.caHasSeed = true;
      this.caSeedY = maxY;
    } else {
      this.caSeedY = Math.max(minY, Math.min(maxY, this.caSeedY | 0));
    }
    this.caGen = 0;

    for (let i = 0; i < 2; i++) {
      const tex = createRgba8uiTexture(gl, { width: w, height: 1, data: init });
      const fb = createFramebufferForTextures(gl, [tex]);
      this._caTex[i] = tex;
      this._caFb[i] = fb;
    }

    this._caFront = 0;
    this._caWidth = w;
  }

  /**
   * Resets the Wolfram CA seed + generation origin. The CA's 1D state is seeded
   * as a single 1-bit at `x`, and generation 0 will be applied at `y`.
   *
   * @param {number} x
   * @param {number} y
   */
  setCaSeed(x, y) {
    const w = this.width | 0;
    const h = this.height | 0;
    if (w <= 0 || h <= 0) return;
    const minX = w >= 3 ? 1 : 0;
    const maxX = w >= 3 ? w - 2 : w - 1;
    const minY = h >= 2 ? 1 : 0;
    const maxY = h >= 3 ? h - 2 : h - 1;
    const sx = Math.max(minX, Math.min(maxX, x | 0));
    const sy = Math.max(minY, Math.min(maxY, y | 0));
    this.caSeedX = sx;
    this.caSeedY = sy;
    this.caGen = 0;
    this.caHasSeed = true;

    if (!this._caTex[0] || this._caWidth !== w) return;

    const gl = this.gl;
    const init = new Uint8Array(w * 4);
    init[sx * 4 + 0] = 1;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = 0; i < 2; i++) {
      const tex = this._caTex[i];
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, init);
    }
    this._caFront = 0;
  }

  /**
   * Lazy-loads + compiles the Wolfram CA programs, and toggles whether it runs.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setCaEnabled(enabled) {
    if (!enabled) {
      this.caEnabled = false;
      return;
    }
    if (this._caUpdate && this._caApply && this._caTex[0]) {
      this.caEnabled = true;
      this.setCaSeed(this.caSeedX, this.caSeedY);
      return;
    }

    if (!this._caLoading) {
      this._caLoading = (async () => {
        try {
          const mod = await import("./shaders-wolfram.js");
          this._caUpdate = this._createCaUpdateProgram(mod.WOLFRAM_UPDATE_FRAG);
          this._caApply = this._createCaApplyProgram(mod.WOLFRAM_APPLY_FRAG);
          this._ensureCaBuffers();
        } finally {
          // Allow retry on failure.
          this._caLoading = null;
        }
      })();
    }

    await this._caLoading;
    if (!this._caUpdate || !this._caApply || !this._caTex[0]) throw new Error("Wolfram CA failed to initialize");
    this.caEnabled = true;
    this.setCaSeed(this.caSeedX, this.caSeedY);
  }

  /**
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createPaintProgram() {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, PAINT_FRAG);
    return {
      program,
      u: {
        state: mustGetUniform(gl, program, "u_state"),
        energy: mustGetUniform(gl, program, "u_energy"),
        size: mustGetUniform(gl, program, "u_size"),
        center: mustGetUniform(gl, program, "u_center"),
        radius: mustGetUniform(gl, program, "u_radius"),
        paint: mustGetUniform(gl, program, "u_paint"),
        addMode: mustGetUniform(gl, program, "u_addMode"),
        seed: mustGetUniform(gl, program, "u_seed"),
        tick: mustGetUniform(gl, program, "u_tick"),
        thermal0: mustGetUniform(gl, program, "u_thermal0"),
        thermal1: mustGetUniform(gl, program, "u_thermal1"),
        latent: mustGetUniform(gl, program, "u_latent"),
      },
    };
  }

  /**
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createStampProgram() {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, STAMP_FRAG);
    return {
      program,
      u: {
        state: mustGetUniform(gl, program, "u_state"),
        energy: mustGetUniform(gl, program, "u_energy"),
        image: mustGetUniform(gl, program, "u_image"),
        palette: mustGetUniform(gl, program, "u_palette"),
        size: mustGetUniform(gl, program, "u_size"),
        imgSize: mustGetUniform(gl, program, "u_imgSize"),
        origin: mustGetUniform(gl, program, "u_origin"),
        ambientTemp: mustGetUniform(gl, program, "u_ambientTemp"),
        edgeStone: mustGetUniform(gl, program, "u_edgeStone"),
        addMode: mustGetUniform(gl, program, "u_addMode"),
        thermal0: mustGetUniform(gl, program, "u_thermal0"),
        thermal1: mustGetUniform(gl, program, "u_thermal1"),
        latent: mustGetUniform(gl, program, "u_latent"),
      },
    };
  }

  /**
   * @returns {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}}
   */
  _createRenderProgram() {
    const gl = this.gl;
    const program = createProgram(gl, FULLSCREEN_VERT, RENDER_FRAG);
    return {
      program,
      u: {
        state: mustGetUniform(gl, program, "u_state"),
        palette: mustGetUniform(gl, program, "u_palette"),
        size: mustGetUniform(gl, program, "u_size"),
        viewMode: mustGetUniform(gl, program, "u_viewMode"),
        ambientTemp: mustGetUniform(gl, program, "u_ambientTemp"),
        camCenter: mustGetUniform(gl, program, "u_camCenter"),
        camZoom: mustGetUniform(gl, program, "u_camZoom"),
      },
    };
  }

  /**
   * @param {number} width
   * @param {number} height
   */
  setWorldSize(width, height) {
    const gl = this.gl;
    const prevW = this.width | 0;
    const prevH = this.height | 0;
    this.width = width | 0;
    this.height = height | 0;
    if (this.width > 0 && this.height > 0) {
      if (prevW > 0 && prevH > 0) {
        const ux = prevW <= 1 ? 0.5 : (this.caSeedX | 0) / (prevW - 1);
        const uy = prevH <= 1 ? 0.5 : (this.caSeedY | 0) / (prevH - 1);
        this.caSeedX = Math.round(ux * Math.max(0, this.width - 1)) | 0;
        this.caSeedY = Math.round(uy * Math.max(0, this.height - 1)) | 0;
      } else {
        this.caSeedX = (this.width >> 1) | 0;
        this.caSeedY = (this.height - 2) | 0;
      }

      // Clamp away from boundary walls / open top row.
      const minX = this.width >= 3 ? 1 : 0;
      const maxX = this.width >= 3 ? this.width - 2 : this.width - 1;
      const minY = this.height >= 2 ? 1 : 0;
      const maxY = this.height >= 3 ? this.height - 2 : this.height - 1;
      this.caSeedX = Math.max(minX, Math.min(maxX, this.caSeedX | 0));
      this.caSeedY = Math.max(minY, Math.min(maxY, this.caSeedY | 0));
      this.caHasSeed = true;
      this.caGen = 0;
    }

    for (let i = 0; i < 2; i++) {
      if (this._stateTex[i]) gl.deleteTexture(this._stateTex[i]);
      if (this._energyTex[i]) gl.deleteTexture(this._energyTex[i]);
      if (this._worldFb[i]) gl.deleteFramebuffer(this._worldFb[i]);

      const stateTex = createRgba8uiTexture(gl, { width: this.width, height: this.height });
      const energyTex = createRgba8uiTexture(gl, { width: this.width, height: this.height });
      const fb = createFramebufferForTextures(gl, [stateTex, energyTex]);

      this._stateTex[i] = stateTex;
      this._energyTex[i] = energyTex;
      this._worldFb[i] = fb;
    }
    this._front = 0;
    this.tick = 0;
    this.clear();
    if (this._caTex[0]) this._ensureCaBuffers();
  }

  /**
   * Clears world to air + boundary stone.
   */
  clear() {
    const gl = this.gl;
    this.tick = 0;
    this.caGen = 0;

    // Avoid feedback loops by ensuring state textures aren't bound for sampling.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const { program, u } = this._clear;
    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform1ui(u.ambientTemp, this.ambientTemp >>> 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal0Tex);
    gl.uniform1i(u.thermal0, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal1Tex);
    gl.uniform1i(u.thermal1, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._latentTex);
    gl.uniform1i(u.latent, 2);

    // Clear both ping-pong buffers so pick/paint work consistently right away.
    this._draw(program, this._worldFb[0], this.width, this.height);
    this._draw(program, this._worldFb[1], this.width, this.height);
    this._front = 0;
    this.tick = 0;

    if (this._caTex[0]) this.setCaSeed(this.caSeedX, this.caSeedY);
  }

  /**
   * @param {ViewMode} mode
   */
  setViewMode(mode) {
    this.viewMode = mode;
  }

  /**
   * @returns {WebGLTexture}
   */
  _srcTex() {
    return this._stateTex[this._front];
  }

  /**
   * @returns {WebGLTexture}
   */
  _srcEnergyTex() {
    return this._energyTex[this._front];
  }

  /**
   * @returns {WebGLFramebuffer}
   */
  _dstFb() {
    return this._worldFb[1 - this._front];
  }

  _swap() {
    this._front = 1 - this._front;
  }

  /**
   * @param {WebGLProgram} program
   * @param {WebGLFramebuffer | null} fb
   * @param {number} w
   * @param {number} h
   */
  _draw(program, fb, w, h) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindVertexArray(this._vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * @param {number} dx
   * @param {number} dy
   * @param {0|1} parity
   */
  _heatPass(dx, dy, parity) {
    const gl = this.gl;
    const { program, u } = this._heat;

    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform2i(u.dir, dx, dy);
    gl.uniform1i(u.parity, parity);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._srcEnergyTex());
    gl.uniform1i(u.energy, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._propTex);
    gl.uniform1i(u.props, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal0Tex);
    gl.uniform1i(u.thermal0, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this._latentTex);
    gl.uniform1i(u.latent, 4);

    this._draw(program, this._dstFb(), this.width, this.height);
    this._swap();
  }

  /**
   * @param {number} dx
   * @param {number} dy
   * @param {0|1} parity
   * @param {0|1} selfStep
   * @param {0|1} doMove
   * @param {number} passSalt
   */
  _matterPass(dx, dy, parity, selfStep, doMove, passSalt) {
    const gl = this.gl;
    const { program, u } = this._matter;

    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform2i(u.dir, dx, dy);
    gl.uniform1i(u.parity, parity);
    gl.uniform1ui(u.tick, this.tick >>> 0);
    gl.uniform1ui(u.seed, this.seed >>> 0);
    gl.uniform1i(u.selfStep, selfStep);
    gl.uniform1i(u.doMove, doMove);
    gl.uniform1ui(u.ambientTemp, this.ambientTemp >>> 0);
    gl.uniform1ui(u.passSalt, passSalt >>> 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._srcEnergyTex());
    gl.uniform1i(u.energy, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._propTex);
    gl.uniform1i(u.props, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal0Tex);
    gl.uniform1i(u.thermal0, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal1Tex);
    gl.uniform1i(u.thermal1, 4);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this._latentTex);
    gl.uniform1i(u.latent, 5);

    this._draw(program, this._dstFb(), this.width, this.height);
    this._swap();
  }

  _caUpdatePass() {
    const ca = this._caUpdate;
    if (!ca) return;
    const src = this._caTex[this._caFront];
    const dst = this._caFb[1 - this._caFront];
    if (!src || !dst) return;

    const gl = this.gl;
    const { program, u } = ca;

    gl.useProgram(program);
    gl.uniform1i(u.width, this.width | 0);
    gl.uniform1ui(u.rule, (this.caRule & 255) >>> 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(u.ca, 0);

    this._draw(program, dst, this.width, 1);
    this._caFront = 1 - this._caFront;
  }

  /**
   * @param {number} emitY
   */
  _caApplyPass(emitY) {
    const ca = this._caApply;
    if (!ca) return;
    const caTex = this._caTex[this._caFront];
    if (!caTex) return;

    const gl = this.gl;
    const { program, u } = ca;
    if (emitY < 0 || emitY >= this.height) return;

    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform1ui(u.ambientTemp, this.ambientTemp >>> 0);
    gl.uniform1ui(u.paintId, (this.caPaintId & 255) >>> 0);
    gl.uniform1i(u.emitY, emitY | 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._srcEnergyTex());
    gl.uniform1i(u.energy, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, caTex);
    gl.uniform1i(u.ca, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal0Tex);
    gl.uniform1i(u.thermal0, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal1Tex);
    gl.uniform1i(u.thermal1, 4);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this._latentTex);
    gl.uniform1i(u.latent, 5);

    this._draw(program, this._dstFb(), this.width, this.height);
    this._swap();
  }

  _golPass() {
    const gol = this._gol;
    if (!gol) return;
    const gl = this.gl;
    const { program, u } = gol;

    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform1ui(u.seed, this.seed >>> 0);
    gl.uniform1ui(u.tick, this.tick >>> 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._srcEnergyTex());
    gl.uniform1i(u.energy, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal0Tex);
    gl.uniform1i(u.thermal0, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal1Tex);
    gl.uniform1i(u.thermal1, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this._latentTex);
    gl.uniform1i(u.latent, 4);

    this._draw(program, this._dstFb(), this.width, this.height);
    this._swap();
  }

  /**
   * Runs one simulation tick (multiple disjoint-pair passes).
   */
  step() {
    // Heat diffusion: unbiased 4-pass (horizontal + vertical, both parities).
    this._heatPass(1, 0, 0);
    this._heatPass(1, 0, 1);
    this._heatPass(0, 1, 0);
    this._heatPass(0, 1, 1);

    // Matter passes: gravity (down), then diagonals (order alternates), then horizontal diffusion.
    const down = [0, -1];
    const dl = [-1, -1];
    const dr = [1, -1];
    const horiz = [1, 0];

    // Single down pass per tick (alternating parity) keeps fall speeds reasonable.
    // The down pass also performs the per-cell "self tick".
    const pY = /** @type {0|1} */ (this.tick & 1);
    // Run a second vertical pass (other parity) with movement disabled so
    // chemistry like ignition works equally in both directions.
    this._matterPass(down[0], down[1], /** @type {0|1} */ (1 - pY), 0, 0, 8 + pY);
    this._matterPass(down[0], down[1], pY, 1, 1, 10 + pY);

    const diagFirst = (this.tick & 1) === 0 ? dl : dr;
    const diagSecond = (this.tick & 1) === 0 ? dr : dl;

    this._matterPass(diagFirst[0], diagFirst[1], 0, 0, 1, 20);
    this._matterPass(diagFirst[0], diagFirst[1], 1, 0, 1, 21);
    this._matterPass(diagSecond[0], diagSecond[1], 0, 0, 1, 22);
    this._matterPass(diagSecond[0], diagSecond[1], 1, 0, 1, 23);

    this._matterPass(horiz[0], horiz[1], 0, 0, 1, 30);
    this._matterPass(horiz[0], horiz[1], 1, 0, 1, 31);
    this._matterPass(horiz[0], horiz[1], 0, 0, 1, 32);
    this._matterPass(horiz[0], horiz[1], 1, 0, 1, 33);

    if (this.golEnabled && this._gol) {
      const interval = Math.max(1, this.golInterval | 0);
      if (((this.tick >>> 0) % interval) === 0) this._golPass();
    }

    if (this.caEnabled && this._caUpdate && this._caApply && this._caTex[0]) {
      const interval = Math.max(1, this.caInterval | 0);
      if (((this.tick >>> 0) % interval) === 0) {
        let emitY = (this.caSeedY | 0) - (this.caGen | 0);
        if (emitY < 1) {
          this.setCaSeed(this.caSeedX, this.caSeedY);
          emitY = this.caSeedY | 0;
        }
        this._caApplyPass(emitY);
        this._caUpdatePass();
        this.caGen = (this.caGen + 1) | 0;
      }
    }

    this.tick++;
  }

  /**
   * Paints a filled circle into the sim grid via a GPU pass.
   * @param {number} x
   * @param {number} y
   * @param {{id: number, temp: number, data: number, flags: number}} cell
   * @param {number} radius
   * @param {{addMode?: boolean} | undefined} [opts]
   */
  paintCircle(x, y, cell, radius, opts) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;

    const gl = this.gl;
    const { program, u } = this._paint;
    const addMode = opts?.addMode ?? false;

    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform2i(u.center, x | 0, y | 0);
    gl.uniform1i(u.radius, radius | 0);
    gl.uniform4ui(u.paint, cell.id >>> 0, clampByte(cell.temp) >>> 0, clampByte(cell.data) >>> 0, clampByte(cell.flags) >>> 0);
    gl.uniform1i(u.addMode, addMode ? 1 : 0);
    gl.uniform1ui(u.seed, this.seed >>> 0);
    gl.uniform1ui(u.tick, this.tick >>> 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._srcEnergyTex());
    gl.uniform1i(u.energy, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal0Tex);
    gl.uniform1i(u.thermal0, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal1Tex);
    gl.uniform1i(u.thermal1, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this._latentTex);
    gl.uniform1i(u.latent, 4);

    this._draw(program, this._dstFb(), this.width, this.height);
    this._swap();
  }

  /**
   * Stamps an image into the sim by mapping pixel colors to particle IDs on the GPU.
   * `originX/originY` is the bottom-left world coordinate where the image's bottom-left will be placed.
   *
   * @param {CanvasImageSource} image
   * @param {number} imgWidth
   * @param {number} imgHeight
   * @param {number} originX
   * @param {number} originY
   * @param {{edgeStone?: boolean, addMode?: boolean} | undefined} [opts]
   */
  stampImage(image, imgWidth, imgHeight, originX, originY, opts) {
    const gl = this.gl;
    const edgeStone = opts?.edgeStone ?? true;
    const addMode = opts?.addMode ?? false;

    this._imgSize.width = imgWidth | 0;
    this._imgSize.height = imgHeight | 0;

    // Upload image to a regular RGBA8 texture (flipped so y=0 is bottom row).
    gl.bindTexture(gl.TEXTURE_2D, this._imgTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    const { program, u } = this._stamp;
    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform2i(u.imgSize, this._imgSize.width, this._imgSize.height);
    gl.uniform2i(u.origin, originX | 0, originY | 0);
    gl.uniform1ui(u.ambientTemp, this.ambientTemp >>> 0);
    gl.uniform1i(u.edgeStone, edgeStone ? 1 : 0);
    gl.uniform1i(u.addMode, addMode ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._srcEnergyTex());
    gl.uniform1i(u.energy, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._imgTex);
    gl.uniform1i(u.image, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this._paletteTex);
    gl.uniform1i(u.palette, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal0Tex);
    gl.uniform1i(u.thermal0, 4);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this._thermal1Tex);
    gl.uniform1i(u.thermal1, 5);

    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this._latentTex);
    gl.uniform1i(u.latent, 6);

    this._draw(program, this._dstFb(), this.width, this.height);
    this._swap();
  }

  /**
   * Reads a single cell back to CPU (slow; use for pick tool only).
   * @param {number} x
   * @param {number} y
   * @returns {{id: number, temp: number, data: number, flags: number}}
   */
  readCell(x, y) {
    const gl = this.gl;
    const out = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._worldFb[this._front]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(x | 0, y | 0, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { id: out[0], temp: out[1], data: out[2], flags: out[3] };
  }

  /**
   * Resize the drawing buffer to match the CSS size.
   */
  resizeCanvasToDisplaySize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render() {
    const gl = this.gl;
    const { program, u } = this._render;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform1i(u.viewMode, this.viewMode === "temperature" ? 1 : 0);
    gl.uniform1ui(u.ambientTemp, this.ambientTemp >>> 0);
    gl.uniform2f(u.camCenter, this.camCenterX, this.camCenterY);
    gl.uniform1f(u.camZoom, this.camZoom);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._paletteTex);
    gl.uniform1i(u.palette, 1);

    this._draw(program, null, this.canvas.width, this.canvas.height);
  }
}
