// @ts-check

import { DEFAULT_AMBIENT_TEMP } from "./particles.js";
import { CLEAR_FRAG, FULLSCREEN_VERT, HEAT_FRAG, MATTER_FRAG, PAINT_FRAG, RENDER_FRAG } from "./shaders.js";
import {
  createFramebufferForTexture,
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
   * @param {GpuSimOptions} opts
   */
  constructor(canvas, particleDefs, paletteTexels, propTexels, opts) {
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

    this._vao = createFullscreenVao(gl);

    // Programs.
    this._heat = this._createHeatProgram();
    this._clear = this._createClearProgram();
    this._matter = this._createMatterProgram();
    this._paint = this._createPaintProgram();
    this._render = this._createRenderProgram();

    // Constant textures.
    this._paletteTex = createRgba8Texture(gl, { width: 256, height: 1, data: paletteTexels });
    this._propTex = createRgba8uiTexture(gl, { width: 256, height: 1, data: propTexels });

    this._stateTex = /** @type {[WebGLTexture, WebGLTexture]} */ ([null, null]);
    this._stateFb = /** @type {[WebGLFramebuffer, WebGLFramebuffer]} */ ([null, null]);
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
        props: mustGetUniform(gl, program, "u_props"),
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
        props: mustGetUniform(gl, program, "u_props"),
        size: mustGetUniform(gl, program, "u_size"),
        dir: mustGetUniform(gl, program, "u_dir"),
        parity: mustGetUniform(gl, program, "u_parity"),
        tick: mustGetUniform(gl, program, "u_tick"),
        seed: mustGetUniform(gl, program, "u_seed"),
        selfStep: mustGetUniform(gl, program, "u_selfStep"),
        ambientTemp: mustGetUniform(gl, program, "u_ambientTemp"),
        passSalt: mustGetUniform(gl, program, "u_passSalt"),
      },
    };
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
        size: mustGetUniform(gl, program, "u_size"),
        center: mustGetUniform(gl, program, "u_center"),
        radius: mustGetUniform(gl, program, "u_radius"),
        paint: mustGetUniform(gl, program, "u_paint"),
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
      },
    };
  }

  /**
   * @param {number} width
   * @param {number} height
   */
  setWorldSize(width, height) {
    const gl = this.gl;
    this.width = width | 0;
    this.height = height | 0;

    for (let i = 0; i < 2; i++) {
      if (this._stateTex[i]) gl.deleteTexture(this._stateTex[i]);
      if (this._stateFb[i]) gl.deleteFramebuffer(this._stateFb[i]);
      const tex = createRgba8uiTexture(gl, { width: this.width, height: this.height });
      const fb = createFramebufferForTexture(gl, tex);
      this._stateTex[i] = tex;
      this._stateFb[i] = fb;
    }
    this._front = 0;
    this.tick = 0;
    this.clear();
  }

  /**
   * Clears world to air + boundary stone.
   */
  clear() {
    const gl = this.gl;
    this.tick = 0;

    // Avoid feedback loops by ensuring state textures aren't bound for sampling.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const { program, u } = this._clear;
    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform1ui(u.ambientTemp, this.ambientTemp >>> 0);

    // Clear both ping-pong buffers so pick/paint work consistently right away.
    this._draw(program, this._stateFb[0], this.width, this.height);
    this._draw(program, this._stateFb[1], this.width, this.height);
    this._front = 0;
    this.tick = 0;
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
   * @returns {WebGLFramebuffer}
   */
  _dstFb() {
    return this._stateFb[1 - this._front];
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
    gl.bindTexture(gl.TEXTURE_2D, this._propTex);
    gl.uniform1i(u.props, 1);

    this._draw(program, this._dstFb(), this.width, this.height);
    this._swap();
  }

  /**
   * @param {number} dx
   * @param {number} dy
   * @param {0|1} parity
   * @param {0|1} selfStep
   * @param {number} passSalt
   */
  _matterPass(dx, dy, parity, selfStep, passSalt) {
    const gl = this.gl;
    const { program, u } = this._matter;

    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform2i(u.dir, dx, dy);
    gl.uniform1i(u.parity, parity);
    gl.uniform1ui(u.tick, this.tick >>> 0);
    gl.uniform1ui(u.seed, this.seed >>> 0);
    gl.uniform1i(u.selfStep, selfStep);
    gl.uniform1ui(u.ambientTemp, this.ambientTemp >>> 0);
    gl.uniform1ui(u.passSalt, passSalt >>> 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._propTex);
    gl.uniform1i(u.props, 1);

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

    // The first matter pass is the "self tick" for per-cell updates.
    this._matterPass(down[0], down[1], 0, 1, 10);
    this._matterPass(down[0], down[1], 1, 0, 11);

    const diagFirst = (this.tick & 1) === 0 ? dl : dr;
    const diagSecond = (this.tick & 1) === 0 ? dr : dl;

    this._matterPass(diagFirst[0], diagFirst[1], 0, 0, 20);
    this._matterPass(diagFirst[0], diagFirst[1], 1, 0, 21);
    this._matterPass(diagSecond[0], diagSecond[1], 0, 0, 22);
    this._matterPass(diagSecond[0], diagSecond[1], 1, 0, 23);

    this._matterPass(horiz[0], horiz[1], 0, 0, 30);
    this._matterPass(horiz[0], horiz[1], 1, 0, 31);

    this.tick++;
  }

  /**
   * Paints a filled circle into the sim grid via a GPU pass.
   * @param {number} x
   * @param {number} y
   * @param {{id: number, temp: number, data: number, flags: number}} cell
   * @param {number} radius
   */
  paintCircle(x, y, cell, radius) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;

    const gl = this.gl;
    const { program, u } = this._paint;

    gl.useProgram(program);
    gl.uniform2i(u.size, this.width, this.height);
    gl.uniform2i(u.center, x | 0, y | 0);
    gl.uniform1i(u.radius, radius | 0);
    gl.uniform4ui(u.paint, cell.id >>> 0, clampByte(cell.temp) >>> 0, clampByte(cell.data) >>> 0, clampByte(cell.flags) >>> 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._stateFb[this._front]);
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
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
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

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex());
    gl.uniform1i(u.state, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._paletteTex);
    gl.uniform1i(u.palette, 1);

    this._draw(program, null, this.canvas.width, this.canvas.height);
  }
}
