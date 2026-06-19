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
