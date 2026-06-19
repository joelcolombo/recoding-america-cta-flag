/* flag-art.js — shared Stars & Stripes line-art renderer.
   Draws the flag into a 2D context through a projection fn, so the SAME artwork can be:
     A1  displaced per-frame on a flat canvas (project applies the wave), or
     A3  drawn flat once into a texture, then bent by a 3D mesh (project is identity).
   Logical flag space is u∈[0,1] left→right (u=0 = mast), v∈[0,1] top→bottom.
   Monochrome line-art only — no fills, no red/blue (honors the brand: --ra-red is signal-only). */
(function () {
  var FLAG = {
    cantonW: 0.40,      // canton width as a fraction of flag width (US spec = 2/5)
    stripes: 13,
    cantonStripes: 7,   // canton covers the top 7 stripes  → canton height = 7/13
  };

  // 50 stars: 9 rows, alternating 6 then 5 (5×6 + 4×5 = 50), in canton-normalised space
  function starPoints() {
    var pts = [], rows = 9, padU = 0.07, padV = 0.085;
    var cw = FLAG.cantonW, ch = FLAG.cantonStripes / FLAG.stripes;
    for (var r = 0; r < rows; r++) {
      var six = r % 2 === 0, n = six ? 6 : 5;
      var vc = padV + (r / (rows - 1)) * (1 - 2 * padV);   // 0..1 within canton
      for (var c = 0; c < n; c++) {
        var f = six ? c / 5 : (c + 0.5) / 5;               // interleave the 5-star rows
        var uc = padU + f * (1 - 2 * padU);
        pts.push([uc * cw, vc * ch]);
      }
    }
    return pts;
  }
  var STARS = starPoints();

  function polyline(ctx, project, u0, u1, v, segs) {
    ctx.beginPath();
    for (var i = 0; i <= segs; i++) {
      var u = u0 + (u1 - u0) * (i / segs), p = project(u, v);
      i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }
  function vline(ctx, project, u, v0, v1, segs) {
    ctx.beginPath();
    for (var i = 0; i <= segs; i++) {
      var v = v0 + (v1 - v0) * (i / segs), p = project(u, v);
      i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }

  /* drawFlag(ctx, opts, project)
     opts: { color, lineAlpha, starAlpha, lineWidth, showStars, showVerticals, vCols, segs }
     project(u, v) -> [x, y] in the context's pixel space */
  function drawFlag(ctx, opts, project) {
    var color = opts.color || '#7FEFFF',
        lineAlpha = opts.lineAlpha != null ? opts.lineAlpha : 0.16,
        starAlpha = opts.starAlpha != null ? opts.starAlpha : 0.55,
        lineWidth = opts.lineWidth || 1,
        showStars = opts.showStars !== false,
        showVerticals = opts.showVerticals !== false,
        vCols = opts.vCols || 18,
        segs = opts.segs || 72;
    var cw = FLAG.cantonW, ch = FLAG.cantonStripes / FLAG.stripes;

    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;

    // faint vertical "cloth" lines first — they make the wave legible (sit under the stripes)
    if (showVerticals) {
      ctx.globalAlpha = lineAlpha * 0.38;
      for (var m = 1; m < vCols; m++) vline(ctx, project, m / vCols, 0, 1, Math.round(segs / 2));
    }

    // 14 horizontal stripe-boundary lines; the 6 interior ones inside the canton start at its right edge
    ctx.globalAlpha = lineAlpha;
    for (var k = 0; k <= FLAG.stripes; k++) {
      var v = k / FLAG.stripes;
      var underCanton = k >= 1 && k <= FLAG.cantonStripes - 1;   // boundaries 1..6
      polyline(ctx, project, underCanton ? cw : 0, 1, v, segs);
    }
    // flag outline (left + right edges) and canton (right + bottom edges)
    vline(ctx, project, 0, 0, 1, Math.round(segs / 2));
    vline(ctx, project, 1, 0, 1, Math.round(segs / 2));
    vline(ctx, project, cw, 0, ch, Math.round(segs / 3));
    polyline(ctx, project, 0, cw, ch, Math.round(segs / 2));

    // stars as dots
    if (showStars) {
      ctx.globalAlpha = starAlpha;
      ctx.fillStyle = color;
      var rad = Math.max(1, lineWidth * 1.15);
      for (var s = 0; s < STARS.length; s++) {
        var p = project(STARS[s][0], STARS[s][1]);
        ctx.beginPath();
        ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  window.FlagArt = { drawFlag: drawFlag, FLAG: FLAG };
})();
/* flag-three.js — Approach 3: REAL cloth physics (Three.js).
   A verlet mass-spring grid, pinned along the left edge (the mast), pulled by gravity and
   pushed by a travelling wind so the free edge flutters like a real flag. The cursor is a
   solid sphere that physically shoves the cloth out of the way — brush it and it swings and
   settles. The flag line-art is a CanvasTexture; a light, fold-aware shader gives the folds
   depth (still cyan line-art, no fills) so it reads as cloth, not a flat decal.
   Three.js (UMD) is lazy-loaded from a CDN on first use. */
(function () {
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.137.0/build/three.min.js';
  var libPromise = null;
  var raf = null, layer = null, opts = null, ro = null, t0 = 0;
  var renderer, scene, camera, mesh, mat, geo, tex, texCanvas, raycaster, ndc;
  var lastStars = null, lastVert = null, lastTilt = null;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- cloth model (proven-scale constants; physics units are independent of the box) ----
  var RES_X = 54, RES_Y = 30;            // particles across × down (more polygons → smoother folds)
  var CW = 260, CH = 260 / 1.9;          // cloth size in physics units
  var MASS = 0.1, DRAG = 0.94;           // more damping → settles instead of floating
  var GRAV = 30;                         // gravity → slight droop of the free (right) edge
  var DT = 0.018, DT2 = DT * DT;
  var ITER = 5;                          // constraint relaxation passes
  var REST_X = CW / (RES_X - 1), REST_Y = CH / (RES_Y - 1);
  var MAXSTEP = REST_X * 1.2;            // per-step clamp → keeps the sim from exploding
  var A3_SIZE = 1.5, A3_TOP_OFFSET = 0.25, A3_SHIFT_PX = 110, PIN_DRIFT = 18;   // A3-only: 50% larger, shifted up 110px; PIN_DRIFT = right-side pin wander
  var P = [], CONS = [];                 // particles + distance constraints
  var mouse3, mouseR = CH * 0.30, MOUSE_PUSH = 2.2, mouseActive = false, lastMoveMs = -1e9;
  var tmp, diff, posArr, normArr;

  function ensureLib() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = THREE_URL;
      s.onload = function () { window.THREE ? resolve(window.THREE) : reject(new Error('THREE missing')); };
      s.onerror = function () { reject(new Error('Could not load Three.js (offline?)')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  function idx(i, j) { return j * RES_X + i; }

  function buildCloth(THREE) {
    P = []; CONS = [];
    for (var j = 0; j < RES_Y; j++) {
      for (var i = 0; i < RES_X; i++) {
        var x = -CW / 2 + (i / (RES_X - 1)) * CW;
        var y = CH / 2 - (j / (RES_Y - 1)) * CH;       // j=0 → top (matches PlaneGeometry + texture)
        P.push({ pos: new THREE.Vector3(x, y, 0), prev: new THREE.Vector3(x, y, 0),
                 pinned: i === 0, rx: x, ry: y });     // pin the LEFT edge (hoist, stars side) — right side waves
      }
    }
    for (var jj = 0; jj < RES_Y; jj++) {
      for (var ii = 0; ii < RES_X; ii++) {
        if (ii < RES_X - 1) CONS.push([idx(ii, jj), idx(ii + 1, jj), REST_X]);          // structural →
        if (jj < RES_Y - 1) CONS.push([idx(ii, jj), idx(ii, jj + 1), REST_Y]);          // structural ↓
        if (ii < RES_X - 1 && jj < RES_Y - 1)                                           // shear ⟍
          CONS.push([idx(ii, jj), idx(ii + 1, jj + 1), Math.hypot(REST_X, REST_Y)]);
      }
    }
    mouse3 = new THREE.Vector3();
  }

  function simulate(tms) {
    var t = tms / 1000;
    var windPow = opts.amp * 2.2 + 12, sp = opts.speed, wv = opts.waves;
    for (var k = 0; k < P.length; k++) {
      var p = P[k]; if (p.pinned) continue;
      var i = k % RES_X, j = (k / RES_X) | 0;
      var u = i / (RES_X - 1);                                    // 0 at the pinned left edge (hoist) → 1 at the free right edge
      var edge = 0.12 + u;                                        // motion grows toward the free (right) edge
      var ph = u * Math.PI * 2 * wv - t * sp * 2.6 + j * 0.22;    // wave travels left → right
      var fx = windPow * (0.55 + 0.15 * Math.sin(ph * 0.6)) * edge;  // steady rightward stream → opens the flag out
      var fy = -GRAV + windPow * 0.18 * Math.cos(ph * 1.3) * edge;   // gravity droop + flutter
      var fz = windPow * 0.85 * Math.sin(ph) * edge;                // billow / travelling wave out of plane
      // verlet integrate
      var ax = fx * DT2 / MASS, ay = fy * DT2 / MASS, az = fz * DT2 / MASS;
      var nx = p.pos.x + (p.pos.x - p.prev.x) * DRAG + ax;
      var ny = p.pos.y + (p.pos.y - p.prev.y) * DRAG + ay;
      var nz = p.pos.z + (p.pos.z - p.prev.z) * DRAG + az;
      // clamp step (stability)
      var dx = nx - p.pos.x, dy = ny - p.pos.y, dz = nz - p.pos.z, dl = Math.hypot(dx, dy, dz);
      if (dl > MAXSTEP) { var s = MAXSTEP / dl; nx = p.pos.x + dx * s; ny = p.pos.y + dy * s; nz = p.pos.z + dz * s; }
      p.prev.set(p.pos.x, p.pos.y, p.pos.z);
      p.pos.set(nx, ny, nz);
    }
    // satisfy distance constraints
    for (var it = 0; it < ITER; it++) {
      for (var c = 0; c < CONS.length; c++) {
        var a = P[CONS[c][0]], b = P[CONS[c][1]], rest = CONS[c][2];
        diff.subVectors(b.pos, a.pos);
        var d = diff.length() || 1e-5, f = (d - rest) / d * 0.5;
        diff.multiplyScalar(f);
        if (!a.pinned) a.pos.add(diff);
        if (!b.pinned) b.pos.sub(diff);
      }
    }
    // cursor sphere shoves the cloth (only while actively moving → feels like brushing fabric)
    mouseActive = (tms - lastMoveMs) < 140;
    if (mouseActive) {
      var R2 = mouseR * mouseR;
      for (var m = 0; m < P.length; m++) {
        var pp = P[m]; if (pp.pinned) continue;
        var mx = pp.pos.x - mouse3.x, my = pp.pos.y - mouse3.y, mz = pp.pos.z - mouse3.z;
        var md2 = mx * mx + my * my + mz * mz;
        if (md2 < R2) { var fall = 1 - md2 / R2; pp.pos.z -= MOUSE_PUSH * fall * fall; }   // soft press → ripples, not a warp
      }
    }
    // hold the pinned left (hoist) edge fixed — the two left corners stay put; the right side waves
    for (var q = 0; q < P.length; q++) if (P[q].pinned) P[q].pos.set(P[q].rx, P[q].ry, 0);
  }

  function buildTexture(THREE) {
    var texW = 2048, texH = Math.round(2048 / 1.9);            // higher-res → sharper line-art
    if (!texCanvas) texCanvas = document.createElement('canvas');
    texCanvas.width = texW; texCanvas.height = texH;
    var cx = texCanvas.getContext('2d');
    cx.clearRect(0, 0, texW, texH);
    window.FlagArt.drawFlag(cx,
      { color: '#ffffff', lineAlpha: 1, starAlpha: 1, lineWidth: 3.2,
        showStars: opts.showStars, showVerticals: opts.showVerticals, vCols: 18, segs: 220 },
      function (u, v) { return [u * texW, v * texH]; });
    if (!tex) {
      tex = new THREE.CanvasTexture(texCanvas);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      if (renderer && renderer.capabilities) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    tex.needsUpdate = true;
    lastStars = opts.showStars; lastVert = opts.showVerticals;
  }

  var VERT = [
    'varying vec2 vUv; varying vec3 vNormal;',
    'void main(){ vUv = uv; vNormal = normalize(normalMatrix * normal);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');
  var FRAG = [
    'uniform sampler2D uTex; uniform vec3 uColor; uniform float uAlpha; uniform vec3 uLight;',
    'varying vec2 vUv; varying vec3 vNormal;',
    'void main(){',
    '  vec4 t = texture2D(uTex, vUv);',
    '  vec3 n = normalize(vNormal); if(!gl_FrontFacing) n = -n;',
    '  float d = dot(n, normalize(uLight)) * 0.5 + 0.5;',   // wrap-lit so folds read as depth
    '  vec3 col = uColor * (0.42 + 0.72 * d);',
    '  gl_FragColor = vec4(col, t.a * uAlpha);',
    '}'
  ].join('\n');

  function frameCamera() {
    var r = layer.getBoundingClientRect(), W = Math.max(1, r.width), H = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H, false);
    var aspect = W / H, fov = camera.fov * Math.PI / 180, tan = Math.tan(fov / 2);
    var fill = 0.82 * (opts.scale || 1.1) * A3_SIZE;         // 50% larger than the shared scale
    var th = (opts.tilt || 0) * Math.PI / 180, ct = Math.abs(Math.cos(th)), st = Math.abs(Math.sin(th));
    var halfW = (CW / 2) * ct + (CH / 2) * st;               // rotated bounding box
    var halfH = (CW / 2) * st + (CH / 2) * ct;
    var dist = Math.max(halfH / (tan * fill), halfW / (tan * aspect * fill));
    var cy = -A3_TOP_OFFSET * (tan * dist);                 // shift the flag UP in the box
    camera.position.set(0, cy, dist);
    camera.aspect = aspect; camera.lookAt(0, cy, 0); camera.updateProjectionMatrix();
    lastTilt = opts.tilt;
  }

  function updateGeometry() {
    for (var k = 0; k < P.length; k++) { posArr[3 * k] = P[k].pos.x; posArr[3 * k + 1] = P[k].pos.y; posArr[3 * k + 2] = P[k].pos.z; }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function render(tms) {
    if (opts.showStars !== lastStars || opts.showVerticals !== lastVert) buildTexture(window.THREE);
    if (opts.tilt !== lastTilt) { mesh.rotation.z = -(opts.tilt || 0) * Math.PI / 180; frameCamera(); }
    mat.uniforms.uAlpha.value = opts.lineAlpha;
    if (!reduce) simulate(tms);
    updateGeometry();
    renderer.render(scene, camera);
  }

  function frame() { render(performance.now() - t0); raf = requestAnimationFrame(frame); }

  function mount(layerEl, sharedOpts) {
    layer = layerEl; opts = sharedOpts;
    return ensureLib().then(function (THREE) {
      tmp = new THREE.Vector3(); diff = new THREE.Vector3();
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.domElement.className = 'flag-render';
      renderer.domElement.style.transform = 'translateY(-' + A3_SHIFT_PX + 'px)';   // hard pixel shift upward
      layer.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, 1, 1, 4000);
      raycaster = new THREE.Raycaster(); ndc = new THREE.Vector2();
      geo = new THREE.PlaneGeometry(CW, CH, RES_X - 1, RES_Y - 1);
      posArr = geo.attributes.position.array;
      mat = new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: null }, uAlpha: { value: opts.lineAlpha },
          uColor: { value: new THREE.Color(opts.color || '#7FEFFF') },
          uLight: { value: new THREE.Vector3(0.35, 0.6, 0.7) }
        },
        vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false, side: THREE.FrontSide
      });
      buildTexture(THREE); mat.uniforms.uTex.value = tex;
      mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
      mesh.rotation.z = -(opts.tilt || 0) * Math.PI / 180;   // tilt the whole flag (hangs from a diagonal top edge)
      buildCloth(THREE);
      frameCamera();
      ro = new ResizeObserver(frameCamera); ro.observe(layer);
      t0 = performance.now();
      if (reduce) { render(0); return; }                   // reduced motion → one static frame
      raf = requestAnimationFrame(frame);
    });
  }

  function unmount() {
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (ro) ro.disconnect(); ro = null;
    if (renderer) {
      if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (geo) geo.dispose(); if (mat) mat.dispose(); if (tex) { tex.dispose(); tex = null; }
      renderer.dispose();
    }
    renderer = scene = camera = mesh = mat = geo = null;
    P = []; CONS = []; mouseActive = false; layer = null;
  }

  // cursor → place the brushing sphere at the cloth point under the pointer
  function pointer(clientX, clientY) {
    if (reduce || !renderer || !mesh) return;
    var r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObject(mesh);
    if (hits.length) {
      mouse3.copy(hits[0].point);          // press point on the cloth surface
      lastMoveMs = performance.now() - t0;
    }
  }

  window.FlagThree = { mount: mount, unmount: unmount, pointer: pointer, ensureLib: ensureLib };
})();
/* flag-init.js — production auto-init for Webflow.
   Self-injects the flag layer into the CTA box carrying  data-cta-flag-host , and lifts the
   box's existing content above it — so NO element-building is needed in the Designer. The
   only Webflow-side touch is adding the data-cta-flag-host attribute to the CTA box.
   Three.js (r137 UMD) is lazy-loaded from jsDelivr by flag-three.js. Tuned values baked in. */
(function () {
  function start() {
    var host = document.querySelector('[data-cta-flag-host]');
    if (!host || !window.FlagThree) return;
    if (host.querySelector('[data-cta-flag]')) return;        // already mounted

    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.style.overflow = 'hidden';
    for (var i = 0; i < host.children.length; i++) {          // keep existing content above the flag
      var ch = host.children[i], cs = getComputedStyle(ch);
      if (cs.position === 'static') ch.style.position = 'relative';
      if (cs.zIndex === 'auto') ch.style.zIndex = '1';
    }
    var layer = document.createElement('div');
    layer.setAttribute('data-cta-flag', '');
    layer.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;';
    host.insertBefore(layer, host.firstChild);

    var opts = {
      color: '#7FEFFF', amp: 20, lineAlpha: 0.38, starAlpha: 0.8,
      showStars: true, showVerticals: false, waves: 2.2, speed: 1.6, scale: 0.65, tilt: 42
    };
    window.FlagThree.mount(layer, opts);
    host.addEventListener('pointermove', function (e) { window.FlagThree.pointer(e.clientX, e.clientY); });
  }
  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
