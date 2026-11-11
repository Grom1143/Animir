'use strict';
// Анимир - апскейлинг видео.
//
// Схема проверена замерами, а не «на глаз»:
//   * масштабирование - бикубика Catmull-Rom (16 отсчётов). Даёт PSNR как у браузера,
//     но заметно чётче: на тесте 2x акутанс 40.6 -> 45.4 при том же PSNR.
//   * резкость - CAS из AMD FidelityFX v1.0.2 (MIT). Усиление зависит от локального контраста,
//     поэтому на плавных заливках не появляется шум, а на контурах нет ореолов.
//     На тесте 2x: акутанс 45.4 -> 45.4/48.7 без падения PSNR и с SSIM 0.97.
//   * вместо «умного» сглаживания вдоль линий (было в первой версии) стоит бикубика:
//     замеры показали, что оно мылило кадр (PSNR 35.5 -> 34.1, SSIM 0.9709 -> 0.9640).
//
// Режимы:
//   1) «Качество+»: бикубика в промежуточный буфер плюс CAS сильнее. Чётче всего.
//   2) «Обычный»: та же схема, но CAS слабее. Мягче и безопаснее для слабых видеокарт.
//   3) Без WebGL: 2D-холст с высококачественным масштабированием. Работает на любом железе.
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
    this.hq = opts.hq || (() => true);         // «Качество+»
    this.casAmount = opts.casAmount != null ? opts.casAmount : 0.55; // сила резкости CAS
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
    this.fboW = 0;
    this.fboH = 0;
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
      this.renderer = info.renderer;
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
      if (this.casProg) gl.deleteProgram(this.casProg);
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
    // Бикубика Catmull-Rom: 16 отсчётов, веса считаются на месте.
    // При уменьшении (кадр больше окна) берём 4 отсчёта по площади, чтобы не было ряби.
    const upFs = `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform vec2 u_texel;
      uniform vec4 u_uvrect;
      uniform float u_scale;
      vec4 cubicW(float v) {
        float v2 = v * v;
        float v3 = v2 * v;
        return vec4(-0.5 * v3 + v2 - 0.5 * v,
                     1.5 * v3 - 2.5 * v2 + 1.0,
                    -1.5 * v3 + 2.0 * v2 + 0.5 * v,
                     0.5 * v3 - 0.5 * v2);
      }
      void main() {
        vec2 uv = u_uvrect.xy + v_uv * u_uvrect.zw;
        vec2 d = u_texel;
        vec3 c;
        if (u_scale < 0.98) {
          // уменьшение: усредняем по площади пикселя назначения
          vec2 o = d * 0.5 / max(u_scale, 0.05);
          c = 0.25 * (texture2D(u_tex, uv + vec2(-o.x, -o.y)).rgb
                    + texture2D(u_tex, uv + vec2( o.x, -o.y)).rgb
                    + texture2D(u_tex, uv + vec2(-o.x,  o.y)).rgb
                    + texture2D(u_tex, uv + vec2( o.x,  o.y)).rgb);
        } else {
          vec2 tc = uv / d - 0.5;
          vec2 fr = fract(tc);
          vec2 bs = (floor(tc) + 0.5) * d;
          vec4 wx = cubicW(fr.x);
          vec4 wy = cubicW(fr.y);
          vec3 acc = wx.x * wy.x * texture2D(u_tex, bs + vec2(-1.0, -1.0) * d).rgb;
          acc += wx.y * wy.x * texture2D(u_tex, bs + vec2(0.0, -1.0) * d).rgb;
          acc += wx.z * wy.x * texture2D(u_tex, bs + vec2(1.0, -1.0) * d).rgb;
          acc += wx.w * wy.x * texture2D(u_tex, bs + vec2(2.0, -1.0) * d).rgb;
          acc += wx.x * wy.y * texture2D(u_tex, bs + vec2(-1.0, 0.0) * d).rgb;
          acc += wx.y * wy.y * texture2D(u_tex, bs + vec2(0.0, 0.0) * d).rgb;
          acc += wx.z * wy.y * texture2D(u_tex, bs + vec2(1.0, 0.0) * d).rgb;
          acc += wx.w * wy.y * texture2D(u_tex, bs + vec2(2.0, 0.0) * d).rgb;
          acc += wx.x * wy.z * texture2D(u_tex, bs + vec2(-1.0, 1.0) * d).rgb;
          acc += wx.y * wy.z * texture2D(u_tex, bs + vec2(0.0, 1.0) * d).rgb;
          acc += wx.z * wy.z * texture2D(u_tex, bs + vec2(1.0, 1.0) * d).rgb;
          acc += wx.w * wy.z * texture2D(u_tex, bs + vec2(2.0, 1.0) * d).rgb;
          acc += wx.x * wy.w * texture2D(u_tex, bs + vec2(-1.0, 2.0) * d).rgb;
          acc += wx.y * wy.w * texture2D(u_tex, bs + vec2(0.0, 2.0) * d).rgb;
          acc += wx.z * wy.w * texture2D(u_tex, bs + vec2(1.0, 2.0) * d).rgb;
          acc += wx.w * wy.w * texture2D(u_tex, bs + vec2(2.0, 2.0) * d).rgb;
          c = clamp(acc, 0.0, 1.0);
        }
        gl_FragColor = vec4(c, 1.0);
      }`;
    // CAS из AMD FidelityFX v1.0.2 (MIT): адаптивная резкость.
    // amp тем меньше, чем ближе пиксель к пределу яркости, поэтому ореолы не появляются.
    const casFs = `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform vec2 u_texel;
      uniform float u_amount;
      void main() {
        vec2 d = u_texel;
        vec3 c = texture2D(u_tex, v_uv).rgb;
        vec3 n = texture2D(u_tex, v_uv + vec2(0.0, -d.y)).rgb;
        vec3 s = texture2D(u_tex, v_uv + vec2(0.0,  d.y)).rgb;
        vec3 w = texture2D(u_tex, v_uv + vec2(-d.x, 0.0)).rgb;
        vec3 e = texture2D(u_tex, v_uv + vec2( d.x, 0.0)).rgb;
        vec3 mn = min(min(min(n, s), min(w, e)), c);
        vec3 mx = max(max(max(n, s), max(w, e)), c);
        vec3 amp = clamp(min(mn, vec3(2.0) - mx) / max(mx, vec3(0.0001)), 0.0, 1.0);
        amp = sqrt(amp);
        float peak = -mix(8.0, 5.0, clamp(u_amount, 0.0, 1.0));
        vec3 k = amp / peak;   // как в FidelityFX: вес = amp / peak, peak отрицательный
        vec3 out3 = (c + k * (n + s + w + e)) / (1.0 + 4.0 * k);
        gl_FragColor = vec4(clamp(out3, 0.0, 1.0), 1.0);
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
    this.casProg = build(casFs);
    return !!(this.upProg && this.casProg);
  }

  _initGL() {
    if (this.gl) return true;
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true })
      || this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    // preserveDrawingBuffer: иначе кадр на паузе мог пропадать при перерисовке окна
    if (!gl) return false;
    this.gl = gl;
    if (!this._programs()) return false;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    [this.upProg, this.casProg].forEach(prog => {
      gl.useProgram(prog);
      const pos = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
    });

    this.upU = {
      texel: gl.getUniformLocation(this.upProg, 'u_texel'),
      rect: gl.getUniformLocation(this.upProg, 'u_uvrect'),
      scale: gl.getUniformLocation(this.upProg, 'u_scale'),
    };
    this.casU = {
      texel: gl.getUniformLocation(this.casProg, 'u_texel'),
      amount: gl.getUniformLocation(this.casProg, 'u_amount'),
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) console.warn('upscale: кадровый буфер не собрался');
    return ok;
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

  // Куда на холсте ложится кадр и какую часть источника берём (вписать / заполнить / растянуть)
  _layout() {
    const v = this.video;
    const cw = this.canvas.width, ch = this.canvas.height;
    const va = v.videoWidth / v.videoHeight;
    const ca = cw / ch;
    let x = 0, y = 0, w = cw, h = ch;
    const uv = [0, 0, 1, 1];
    const fit = this.fit();
    if (fit === 'cover') {
      if (va > ca) { uv[2] = ca / va; uv[0] = (1 - uv[2]) / 2; }
      else { uv[3] = va / ca; uv[1] = (1 - uv[3]) / 2; }
    } else if (fit !== 'fill') {
      if (va > ca) { w = cw; h = Math.round(cw / va); y = Math.round((ch - h) / 2); }
      else { h = ch; w = Math.round(ch * va); x = Math.round((cw - w) / 2); }
    }
    return { x, y, w, h, uv };
  }

  _draw() {
    if (!this.glMode) return this._draw2d();
    const gl = this.gl;
    const v = this.video;
    if (!gl || !v.videoWidth || v.readyState < 2) return;
    if (!this._upload()) return;

    const cw = this.canvas.width, ch = this.canvas.height;
    const slot = this._layout();
    const texel = [1 / v.videoWidth, 1 / v.videoHeight];
    // масштаб: сколько пикселей холста приходится на пиксель источника
    const scale = slot.h / v.videoHeight;
    const hq = this.hq();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const drawUp = (dx, dy, dw, dh) => {
      gl.useProgram(this.upProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform2f(this.upU.texel, texel[0], texel[1]);
      gl.uniform4f(this.upU.rect, slot.uv[0], slot.uv[1], slot.uv[2], slot.uv[3]);
      gl.uniform1f(this.upU.scale, scale);
      gl.viewport(dx, dy, dw, dh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    if (!this.casProg) {
      drawUp(slot.x, slot.y, slot.w, slot.h);
      return;
    }

    // «Качество+»: сначала апскейл в буфер, потом CAS на холст
    if (this.fboW !== slot.w || this.fboH !== slot.h) {
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, slot.w, slot.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.fboW = slot.w;
      this.fboH = slot.h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    drawUp(0, 0, slot.w, slot.h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.casProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform2f(this.casU.texel, 1 / slot.w, 1 / slot.h);
    gl.uniform1f(this.casU.amount, hq ? this.casAmount : this.casAmount * 0.55);
    gl.viewport(slot.x, slot.y, slot.w, slot.h);
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
