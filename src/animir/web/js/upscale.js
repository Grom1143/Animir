'use strict';
// Анимир - апскейлинг видео.
//
// Три режима, чтобы работало и на мощной видеокарте, и на встроенной, и совсем без WebGL:
//   1) «Качество+» (два прохода): сглаживание с сохранением краёв, затем резкость RCAS и подчёркивание
//      линий аниме. Дороже, но картинка заметно чище.
//   2) «Обычный» (один проход): тот же апскейл с лёгкой резкостью.
//   3) Без WebGL: холст 2D с высококачественным масштабированием и мягким контрастом. Не чудо,
//      но лучше, чем растянутое браузером видео, и работает на любом железе.
//
// «Авто» само подбирает уровень: начинает с 1080p (или 720p на программном рендере), поднимает
// до 1440p/4K, если видеокарта успевает, и опускает при просадках. Ручной уровень - это потолок,
// но не выше размера окна: иначе браузер уменьшает картинку и она мылится.

class Upscaler {
  static info() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { gl: false, renderer: '', maxTexture: 0 };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        gl: true,
        renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '',
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      };
    } catch (e) {
      return { gl: false, renderer: '', maxTexture: 0 };
    }
  }

  static supported() {
    return true;  // без WebGL работает запасной режим на 2D-холсте
  }

  constructor(video, root, opts = {}) {
    this.video = video;
    this.root = root;
    this.fit = opts.fit || (() => 'contain');
    this.target = opts.target || (() => 0);     // 0 - авто
    this.hq = opts.hq || (() => true);         // «Качество+»: два прохода
    this.onSlow = opts.onSlow || (() => {});
    this.onFatal = opts.onFatal || (() => {});
    this.onLevel = opts.onLevel || (() => {});

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pl-up';
    this.canvas.hidden = true;
    this.subs = document.createElement('div');
    this.subs.className = 'pl-subs';
    this.subs.hidden = true;
    root.insertBefore(this.subs, video.nextSibling);
    root.insertBefore(this.canvas, this.subs);

    this.gl = null;
    this.ctx2d = null;
    this.fbo = null;
    this.fboTex = null;
    this.enabled = false;
    this.auto = false;
    this.level = 1080;         // текущий уровень для авто
    this.displayH = 900;
    this.samples = 0;
    this.gpuMs = 0;
    this.slowFrames = 0;
    this.ladderTick = 0;
    this.raf = 0;
    this.vfc = 0;
    this.software = false;
    this._onResize = () => this._resize();
    addEventListener('resize', this._onResize);
    this.video.addEventListener('seeked', () => { if (this.enabled) this._draw(); });
    this.video.addEventListener('pause', () => { if (this.enabled) this._draw(); });
    this._observer = new ResizeObserver(this._onResize);
    this._observer.observe(root);
  }

  enable() {
    if (this.enabled) return true;
    const info = Upscaler.info();
    if (info.gl && this._initGL()) {
      this.glMode = true;
      this.software = /swiftshader|software|llvmpipe|basic render/i.test(info.renderer);
    } else {
      this.glMode = false;  // запасной путь: 2D-холст
      this.ctx2d = this.canvas.getContext('2d');
      if (!this.ctx2d) return false;
    }
    this.enabled = true;
    this.canvas.hidden = false;
    this.video.classList.add('upscaled');
    this.auto = !+this.target();
    this.level = this.software ? 720 : 1080;
    this._resize();
    this._draw();          // на паузе новых кадров не будет - показываем текущий
    this._schedule();
    return true;
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.canvas.hidden = true;
    this.video.classList.remove('upscaled');
    this.subs.hidden = true;
    this.subs.textContent = '';
    cancelAnimationFrame(this.raf);
    if (this.video.cancelVideoFrameCallback && this.vfc) this.video.cancelVideoFrameCallback(this.vfc);
    this.vfc = 0;
    this._restoreSubs();
  }

  destroy() {
    this.disable();
    removeEventListener('resize', this._onResize);
    try { this._observer.disconnect(); } catch (e) { /* старый движок */ }
    this.canvas.remove();
    this.subs.remove();
    const gl = this.gl;
    if (gl) {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.fboTex) gl.deleteTexture(this.fboTex);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      if (this.upProg) gl.deleteProgram(this.upProg);
      if (this.sharpProg) gl.deleteProgram(this.sharpProg);
    }
    this.gl = null;
  }

  // ---------- WebGL ----------
  _programs() {
    const gl = this.gl;
    const vs = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }`;
    const upFs = `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform vec2 u_texel;
      uniform float u_sharp;
      uniform vec4 u_uvrect;
      float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      void main() {
        vec2 uv = u_uvrect.xy + v_uv * u_uvrect.zw;
        vec3 c = texture2D(u_tex, uv).rgb;
        float lc = luma(c);
        vec2 o = u_texel * 0.8;
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853981634;
          vec2 dir = vec2(cos(a), sin(a));
          vec3 s = texture2D(u_tex, clamp(uv + dir * o, vec2(0.0), vec2(1.0))).rgb;
          float d = abs(luma(s) - lc);
          float w = 1.0 / (1.0 + d * 22.0);
          acc += s * w;
          wsum += w;
        }
        vec3 sm = acc / max(wsum, 0.001);
        // возвращаем детали, не теряя сглаживания
        vec3 col = sm + (c - sm) * (1.0 + u_sharp * 3.4);
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }`;
    const sharpFs = `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform vec2 u_texel;
      uniform float u_strength;
      float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      void main() {
        vec3 c = texture2D(u_tex, v_uv).rgb;
        vec3 n = texture2D(u_tex, v_uv + vec2(0.0, -u_texel.y)).rgb;
        vec3 s = texture2D(u_tex, v_uv + vec2(0.0,  u_texel.y)).rgb;
        vec3 w = texture2D(u_tex, v_uv + vec2(-u_texel.x, 0.0)).rgb;
        vec3 e = texture2D(u_tex, v_uv + vec2( u_texel.x, 0.0)).rgb;
        float ln = luma(n), ls = luma(s), lw = luma(w), le = luma(e), lc = luma(c);
        float avg = (ln + ls + lw + le) * 0.25;
        float mn = min(min(ln, ls), min(lw, le));
        float mx = max(max(ln, ls), max(lw, le));
        float cont = clamp((mx - mn) * 4.0, 0.0, 1.0);
        // резкость: усиливаем перепад к среднему, но только на контрастных местах
        vec3 sharp = c + (c - vec3(avg)) * u_strength * (0.35 + 0.65 * cont);
        // линии аниме: центр темнее окружения - чуть темним контур, чтобы он не «мылился»
        float line = smoothstep(0.015, 0.14, avg - lc) * cont;
        sharp *= (1.0 - line * 0.22);
        gl_FragColor = vec4(clamp(sharp, 0.0, 1.0), 1.0);
      }`;
    const make = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('upscale shader:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const build = fsSrc => {
      const vsh = make(gl.VERTEX_SHADER, vs);
      const fsh = make(gl.FRAGMENT_SHADER, fsSrc);
      if (!vsh || !fsh) return null;
      const prog = gl.createProgram();
      gl.attachShader(prog, vsh);
      gl.attachShader(prog, fsh);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('upscale link:', gl.getProgramInfoLog(prog));
        return null;
      }
      return prog;
    };
    this.upProg = build(upFs);
    this.sharpProg = build(sharpFs);
    return !!(this.upProg && this.sharpProg);
  }

  _initGL() {
    if (this.gl) return true;
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false })
      || this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
    if (!gl) return false;
    this.gl = gl;
    if (!this._programs()) return false;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    [this.upProg, this.sharpProg].forEach(prog => {
      gl.useProgram(prog);
      const pos = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
    });

    this.upU = {
      texel: gl.getUniformLocation(this.upProg, 'u_texel'),
      sharp: gl.getUniformLocation(this.upProg, 'u_sharp'),
      rect: gl.getUniformLocation(this.upProg, 'u_uvrect'),
    };
    this.sharpU = {
      texel: gl.getUniformLocation(this.sharpProg, 'u_texel'),
      strength: gl.getUniformLocation(this.sharpProg, 'u_strength'),
    };

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    this._texParams(gl);
    // кадр из <video> приходит сверху вниз, а у текстур WebGL начало координат снизу:
    // без этого видео вставало вверх ногами
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    this.fbo = gl.createFramebuffer();
    this.fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    this._texParams(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }

  _texParams(gl) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  _resize() {
    if (!this.enabled) return;
    const cssW = Math.max(1, this.root.clientWidth);
    const cssH = Math.max(1, this.root.clientHeight);
    this.displayH = Math.round(cssH * Math.min(devicePixelRatio || 1, 2));
    const aspect = cssW / cssH;
    const chosen = +this.target() || 0;
    let h = chosen ? Math.min(chosen, this.displayH) : Math.min(this.auto ? this.level : this.displayH, this.displayH);
    h = Math.max(480, Math.min(h, 2160));
    const w = Math.round(h * aspect);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      if (this.gl) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
    }
  }

  _schedule() {
    if (!this.enabled) return;
    if (this.video.requestVideoFrameCallback) {
      this.vfc = this.video.requestVideoFrameCallback(() => this._frame());
    } else {
      this.raf = requestAnimationFrame(() => this._frame());
    }
  }

  _frame() {
    if (!this.enabled) return;
    const t0 = performance.now();
    this._draw();
    this._captions();
    this.frameMs = performance.now() - t0;
    this.samples++;
    // раз в 30 кадров ждём видеокарту (gl.finish): только так видно, успевает ли она
    if (this.gl && this.samples % 30 === 0) {
      this.gl.finish();
      this.gpuMs = performance.now() - t0;
      this._ladder();
    }
    this._schedule();
  }

  _ladder() {
    if (!this.auto || this.software) return;  // ручной уровень и программный рендер не трогаем
    if ((this.gpuMs || 0) > 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    this.ladderTick++;
    if (this.ladderTick < 3) return;  // смотрим не меньше ~3 секунд
    this.ladderTick = 0;
    const steps = [720, 1080, 1440, 2160];
    const i = steps.indexOf(this.level);
    if (this.slowFrames >= 4) {
      this.slowFrames = 0;
      if (i > 0) {
        this.level = steps[i - 1];
        this._resize();
        this._draw();
        this.onLevel('Апскейлинг: видеокарта не успевает, уровень ' + this.level + 'p');
      } else {
        this.disable();
        this.onFatal('Апскейлинг выключен: даже 720p не тянет');
      }
      return;
    }
    if ((this.gpuMs || 99) < 18 && i < steps.length - 1 && steps[i + 1] <= this.displayH) {
      this.level = steps[i + 1];
      this._resize();
      this._draw();
      this.onLevel('Апскейлинг поднят до ' + this.level + 'p');
    }
  }

  _upload() {
    const gl = this.gl;
    const v = this.video;
    if (!gl || !v.videoWidth) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
    return true;
  }

  _rect(toFbo) {
    const v = this.video;
    const cw = this.canvas.width, ch = this.canvas.height;
    if (toFbo) return { x: 0, y: 0, w: cw, h: ch, uv: [0, 0, 1, 1] };
    const va = v.videoWidth / v.videoHeight;
    const ca = cw / ch;
    let x = 0, y = 0, w = cw, h = ch, uv = [0, 0, 1, 1];
    const fit = this.fit();
    if (fit === 'cover') {
      if (va > ca) { uv[2] = ca / va; uv[0] = (1 - uv[2]) / 2; }
      else { uv[3] = va / ca; uv[1] = (1 - uv[3]) / 2; }
    } else if (fit !== 'fill') {
      if (va > ca) { h = Math.round(cw / va); y = Math.round((ch - h) / 2); }
      else { w = Math.round(ch * va); x = Math.round((cw - w) / 2); }
    }
    return { x, y, w, h, uv };
  }

  _draw() {
    if (!this.glMode) return this._draw2d();
    const gl = this.gl;
    const v = this.video;
    if (!gl || !v.videoWidth || v.readyState < 2) return;
    if (!this._upload()) return;
    const texel = [1 / v.videoWidth, 1 / v.videoHeight];
    const useSharp = this.hq() && this.sharpProg;

    // проход 1: апскейл с сохранением краёв (в буфер, если потом будет второй проход)
    const first = useSharp ? this._rect(true) : this._rect(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, useSharp ? this.fbo : null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(first.x, first.y, first.w, first.h);
    gl.useProgram(this.upProg);
    gl.uniform2f(this.upU.texel, texel[0], texel[1]);
    gl.uniform1f(this.upU.sharp, useSharp ? 0.45 : 0.75);
    gl.uniform4f(this.upU.rect, first.uv[0], first.uv[1], first.uv[2], first.uv[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!useSharp) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }
    // проход 2: резкость и линии аниме поверх готового кадра
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.sharpProg);
    gl.uniform2f(this.sharpU.texel, 1 / this.canvas.width, 1 / this.canvas.height);
    gl.uniform1f(this.sharpU.strength, 0.95);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // запасной путь без WebGL: масштабирование 2D-холстом с аккуратным контрастом
  _draw2d() {
    const g = this.ctx2d;
    const v = this.video;
    if (!g || !v.videoWidth) return;
    const cw = this.canvas.width, ch = this.canvas.height;
    const va = v.videoWidth / v.videoHeight, ca = cw / ch;
    let w = cw, h = ch, x = 0, y = 0;
    const fit = this.fit();
    if (fit === 'cover') { if (va > ca) w = Math.round(ch * va); else h = Math.round(cw / va); x = (cw - w) / 2; y = (ch - h) / 2; }
    else if (fit !== 'fill') {
      if (va > ca) { h = Math.round(cw / va); y = (ch - h) / 2; } else { w = Math.round(ch * va); x = (cw - w) / 2; }
    }
    g.fillStyle = '#000';
    g.fillRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.filter = 'contrast(1.06) saturate(1.03)';
    g.drawImage(v, x, y, w, h);
    g.filter = 'none';
  }

  // ---------- субтитры ----------
  _captionTrack() {
    const tracks = this.video.textTracks || [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.mode === 'showing' || (t.kind === 'subtitles' && t.cues && t.activeCues && t.activeCues.length)) return t;
    }
    return null;
  }

  _captions() {
    const track = this._captionTrack();
    if (!track) {
      if (!this.subs.hidden) { this.subs.hidden = true; this.subs.textContent = ''; }
      return;
    }
    track.mode = 'hidden';
    const cues = track.activeCues || [];
    if (!cues.length) { this.subs.hidden = true; this.subs.textContent = ''; return; }
    const text = Array.from(cues).map(c => String(c.text || '').replace(/<[^>]+>/g, '')).join('\n').trim();
    this.subs.hidden = !text;
    if (this.subs.textContent !== text) this.subs.textContent = text;
  }

  _restoreSubs() {
    const tracks = this.video.textTracks || [];
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].mode === 'hidden' && tracks[i].kind === 'subtitles') tracks[i].mode = 'showing';
    }
  }
}
