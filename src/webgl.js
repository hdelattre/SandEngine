// @ts-check

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} source
 * @returns {WebGLShader}
 */
export function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "(no log)";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {string} vertexSource
 * @param {string} fragmentSource
 * @returns {WebGLProgram}
 */
export function createProgram(gl, vertexSource, fragmentSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "(no log)";
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string} name
 * @returns {WebGLUniformLocation}
 */
export function mustGetUniform(gl, program, name) {
  const loc = gl.getUniformLocation(program, name);
  if (!loc) throw new Error(`missing uniform ${name}`);
  return loc;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @returns {WebGLVertexArrayObject}
 */
export function createFullscreenVao(gl) {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray failed");
  gl.bindVertexArray(vao);
  return vao;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {{width: number, height: number, data?: Uint8Array}} opts
 * @returns {WebGLTexture}
 */
export function createRgba8uiTexture(gl, opts) {
  const tex = gl.createTexture();
  if (!tex) throw new Error("createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8UI,
    opts.width,
    opts.height,
    0,
    gl.RGBA_INTEGER,
    gl.UNSIGNED_BYTE,
    opts.data ?? null,
  );
  return tex;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {{width: number, height: number, data?: Uint8Array}} opts
 * @returns {WebGLTexture}
 */
export function createRgba8Texture(gl, opts) {
  const tex = gl.createTexture();
  if (!tex) throw new Error("createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, opts.width, opts.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, opts.data ?? null);
  return tex;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLTexture} tex
 * @returns {WebGLFramebuffer}
 */
export function createFramebufferForTexture(gl, tex) {
  const fb = gl.createFramebuffer();
  if (!fb) throw new Error("createFramebuffer failed");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fb);
    throw new Error(`incomplete framebuffer: ${status}`);
  }
  return fb;
}

