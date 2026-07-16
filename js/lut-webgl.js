class LUTWebGL {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.program = null;
    this.vbo = null;
    this.texImage = null;
    this.texLUT = null;
    this.supported = false;

    try {
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: false });
      if (!gl) throw new Error('WebGL 2 not supported');
      this.gl = gl;
      this.initShaders();
      if (!this.program) throw new Error('shader init failed');
      this.initGeometry();
      this.supported = true;
      console.log('[WebGL] 初始化成功');
    } catch (e) {
      console.warn('[WebGL] 不可用，使用 CPU 渲染:', e.message);
    }
  }

  initShaders() {
    const gl = this.gl;

    const vsSrc = `#version 300 es
      in vec2 a_pos;
      out vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }`;

    const fsSrc = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;

      uniform sampler2D u_image;
      uniform sampler3D u_lut;
      uniform float u_lutSize;
      uniform float u_compare;
      uniform float u_splitX;

      void main() {
        vec4 color = texture(u_image, v_uv);
        if (u_compare > 0.5 && gl_FragCoord.x > u_splitX) {
          fragColor = color;
          return;
        }
        vec3 lutCoord = color.rgb * (u_lutSize - 1.0) / u_lutSize + 0.5 / u_lutSize;
        vec3 lutColor = texture(u_lut, lutCoord).rgb;
        fragColor = vec4(lutColor, color.a);
      }`;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[WebGL] 着色器链接失败:', gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;
    this.locApos = gl.getAttribLocation(program, 'a_pos');
    this.locImage = gl.getUniformLocation(program, 'u_image');
    this.locLut = gl.getUniformLocation(program, 'u_lut');
    this.locLutSize = gl.getUniformLocation(program, 'u_lutSize');
    this.locCompare = gl.getUniformLocation(program, 'u_compare');
    this.locSplitX = gl.getUniformLocation(program, 'u_splitX');
  }

  compileShader(type, src) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[WebGL] 着色器编译失败:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  initGeometry() {
    const gl = this.gl;
    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(this.locApos);
    gl.vertexAttribPointer(this.locApos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  uploadImage(image) {
    const gl = this.gl;
    if (!gl) return;

    if (this.texImage) {
      gl.deleteTexture(this.texImage);
    }

    this.texImage = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texImage);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  uploadLUT(lut) {
    const gl = this.gl;
    if (!gl || !lut) return;

    if (this.texLUT) {
      gl.deleteTexture(this.texLUT);
    }

    const { data, size } = lut;
    const pixels = new Uint8Array(size * size * size * 4);

    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const srcIdx = r + g * size + b * size * size;
          const dstIdx = (b * size * size + g * size + r) * 4;
          const c = data[srcIdx] || [0, 0, 0];
          pixels[dstIdx]     = Math.round(c[0] * 255);
          pixels[dstIdx + 1] = Math.round(c[1] * 255);
          pixels[dstIdx + 2] = Math.round(c[2] * 255);
          pixels[dstIdx + 3] = 255;
        }
      }
    }

    this.texLUT = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.texLUT);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    this.currentLutSize = size;
  }

  render(width, height, compareMode) {
    const gl = this.gl;
    if (!gl || !this.program || !this.texImage) return false;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texImage);
    gl.uniform1i(this.locImage, 0);

    if (this.texLUT) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, this.texLUT);
      gl.uniform1i(this.locLut, 1);
      gl.uniform1f(this.locLutSize, this.currentLutSize || 17);
    }

    gl.uniform1f(this.locCompare, compareMode ? 1.0 : 0.0);
    gl.uniform1f(this.locSplitX, width / 2);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    return true;
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  destroy() {
    const gl = this.gl;
    if (!gl) return;
    if (this.texImage) gl.deleteTexture(this.texImage);
    if (this.texLUT) gl.deleteTexture(this.texLUT);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
  }
}
