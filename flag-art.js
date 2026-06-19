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
