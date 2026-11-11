'use strict';
// Анимир - апскейлинг видео на WebGL.
//
// Это не нейросеть и не «AI»: честный шейдерный апскейл, который успевает за кадром на обычном
// ноутбуке. Два приёма в одном проходе:
//   1) сглаживание с учётом краёв: соседние пиксели смешиваются тем сильнее, чем ближе их яркость,
//      поэтому контуры в аниме не «мылятся»;
//   2) адаптивная резкость: усиливаем перепад яркости там, где он уже есть, и не трогаем ровные заливки
//      (иначе на небе и волосах появляются ореолы).
// Кадр берётся прямо из <video> (texImage2D), поэтому работает и с HLS, и с mp4, без ffmpeg и без задержек.
//
// Слабые видеокарты: если кадр рисуется дольше ~26 мс, разрешение рендера снижается ступенями,
// а если и это не помогает - апскейлинг выключается и сообщает об этом.

class Upscaler {
  static supported() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      return !!gl;
    } catch (e) { return false; }
  }

  constructor(video, root, opts = {}) {
    this.video = video;
    this.root = root;
    this.fit = opts.fit || (() => 'contain');
    this.onSlow = opts.onSlow || (() => {});
    this.onFatal = opts.onFatal || (() => {});
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pl-up';
    this.canvas.hidden = true;
    this.subs = document.createElement('div');
    this.subs.className = 'pl-subs';
    this.subs.hidden = true;
    // холст ставим сразу после <video>: так он под элементами управления и под сообщениями плеера
    root.insertBefore(this.subs, video.nextSibling);
    root.insertBefore(this.canvas, this.subs);
    this.gl = null;
    this.program = null;
    this.texture = null;
    this.enabled = false;
    this.scale = 1;            // доля от полного разрешения окна (для слабых карт)
    this.frameMs = 0;
    this.gpuMs = 0;
    this.samples = 0;
    this.slowFrames = 0;
    this.raf = 0;
    this.vfc = 0;
    this._onResize = () => this._resize();
    addEventListener('resize', this._onResize);
    // перемотка и пауза: новых кадров нет, рисуем текущий вручную
    this.video.addEventListener('seeked', () => { if (this.enabled) this._draw(); });
    this.video.addEventListener('pause', () => { if (this.enabled) this._draw(); });
    this._observer = new ResizeObserver(this._onResize);
    this._observer.observe(root);
  }

  enable() {
    if (this.enabled) return true;
    if (!this._init()) return false;
    this.enabled = true;
    this.canvas.hidden = false;
    this.video.classList.add('upscaled');
    // на батарее рисуем чуть дешевле: на глаз почти не видно, а видеокарте легче
    if (document.documentElement.classList.contains('power')) this.scale = Math.min(this.scale, 0.8);
    this._resize();
    this._draw();          // пауза: новых кадров не будет, показываем текущий
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
      if (this.program) gl.deleteProgram(this.program);
    }
    this.gl = null;
  }

  // ---------- WebGL ----------
  _init() {
    if (this.gl) return true;
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false })
      || this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
    if (!gl) return false;
    const vs = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }`;
    const fs = `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform vec2 u_texel;     // размер пикселя исходника в uv
      uniform float u_sharp;    // сила резкости
      uniform vec4 u_uvrect;    // x, y, ширина, высота видимой части исходника

      float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

      void main() {
        vec2 uv = u_uvrect.xy + v_uv * u_uvrect.zw;
        vec3 c = texture2D(u_tex, uv).rgb;
        float lc = luma(c);

        // 8 соседей на расстоянии ~0.75 исходного пикселя
        vec2 o = u_texel * 0.75;
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853981634;      // 45 градусов
          vec2 dir = vec2(cos(a), sin(a));
          vec3 s = texture2D(u_tex, clamp(uv + dir * o, vec2(0.0), vec2(1.0))).rgb;
          float d = abs(luma(s) - lc);
          // близкие по яркости пиксели смешиваем сильнее: контур остаётся контуром
          float w = 1.0 / (1.0 + d * 22.0);
          acc += s * w;
          wsum += w;
        }
        vec3 smoothCol = acc / max(wsum, 0.001);
        // мягко убираем шум, но исходную деталь не теряем:
        // возвращаем разницу между оригиналом и сглаженным с усилением (unsharp mask)
        vec3 col = smoothCol + (c - smoothCol) * (1.0 + u_sharp * 2.2);
        // и слегка подчёркиваем контур там, где перепад яркости уже заметный
        float edge = smoothstep(0.05, 0.30, abs(lc - luma(smoothCol)));
        col += (c - smoothCol) * edge * u_sharp;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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
    const vsh = make(gl.VERTEX_SHADER, vs);
    const fsh = make(gl.FRAGMENT_SHADER, fs);
    if (!vsh || !fsh) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('upscale link:', gl.getProgramInfoLog(prog));
      return false;
    }
    this.gl = gl;
    this.program = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    this.u_tex = gl.getUniformLocation(prog, 'u_tex');
    this.u_texel = gl.getUniformLocation(prog, 'u_texel');
    this.u_sharp = gl.getUniformLocation(prog, 'u_sharp');
    this.u_uvrect = gl.getUniformLocation(prog, 'u_uvrect');
    gl.uniform1i(this.u_tex, 0);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return true;
  }

  _resize() {
    if (!this.enabled) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cssW = Math.max(1, this.root.clientWidth);
    const cssH = Math.max(1, this.root.clientHeight);
    // потолок 4K по высоте: выше всё равно не покажет экран
    const cap = 2160;
    let w = Math.round(cssW * dpr * this.scale);
    let h = Math.round(cssH * dpr * this.scale);
    if (h > cap) { w = Math.round(w * cap / h); h = cap; }
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
    const dt = performance.now() - t0;
    this.frameMs = this.frameMs ? this.frameMs * 0.9 + dt * 0.1 : dt;
    // раз в 30 кадров дожидаемся видеокарты (gl.finish): только так видно, успевает ли она,
    // иначе время кадра - это лишь постановка задач в очередь и оно почти нулевое
    this.samples = (this.samples || 0) + 1;
    if (this.samples % 30 === 0) {
      this.gl.finish();
      this.gpuMs = performance.now() - t0;
    }
    this._adapt();
    this._schedule();
  }

  _adapt() {
    // если видеокарта стабильно не успевает - снижаем разрешение рендера, потом выключаем
    const slow = (this.gpuMs || 0) > 30;
    if (slow) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames < 4) return;
    this.slowFrames = 0;
    if (this.scale > 0.72) {
      this.scale = Math.max(0.7, this.scale - 0.15);
      this._resize();
      this.onSlow('Видеокарта не успевает: снизили разрешение апскейлинга');
      return;
    }
    this.disable();
    this.onFatal('Апскейлинг выключен: видеокарта не успевает');
  }

  _draw() {
    const gl = this.gl;
    const v = this.video;
    if (!gl || !v.videoWidth || v.readyState < 2) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
    gl.uniform2f(this.u_texel, 1 / v.videoWidth, 1 / v.videoHeight);
    gl.uniform1f(this.u_sharp, 0.35);

    // как показывать кадр: вписать, заполнить с обрезкой или растянуть
    const cw = this.canvas.width, ch = this.canvas.height;
    const va = v.videoWidth / v.videoHeight;
    const ca = cw / ch;
    let x = 0, y = 0, w = cw, h = ch, uvx = 0, uvy = 0, uvw = 1, uvh = 1;
    const fit = this.fit();
    if (fit === 'cover') {
      if (va > ca) { uvw = ca / va; uvx = (1 - uvw) / 2; } else { uvh = va / ca; uvy = (1 - uvh) / 2; }
    } else if (fit !== 'fill') {
      if (va > ca) { h = Math.round(cw / va); y = Math.round((ch - h) / 2); } else { w = Math.round(ch * va); x = Math.round((cw - w) / 2); }
    }
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(x, y, w, h);
    gl.uniform4f(this.u_uvrect, uvx, uvy, uvw, uvh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---------- субтитры ----------
  // Браузер рисует субтитры внутри самого <video>, а мы его скрываем ради апскейлинга.
  // Поэтому текст берём из дорожки и рисуем своим слоем: заодно работает ночной размер шрифта.
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
    track.mode = 'hidden';  // нативная отрисовка поверх нашего холста не нужна
    const cues = track.activeCues || [];
    if (!cues.length) { this.subs.hidden = true; this.subs.textContent = ''; return; }
    const text = Array.from(cues).map(c => String(c.text || '').replace(/<[^>]+>/g, '')).join('\n').trim();
    this.subs.hidden = !text;
    if (this.subs.textContent !== text) this.subs.textContent = text;
  }

  _restoreSubs() {
    const tracks = this.video.textTracks || [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.mode === 'hidden' && t.kind === 'subtitles') t.mode = 'showing';
    }
  }
}
