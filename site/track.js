/* Retro Booth: Umami custom events.
 * Loaded on every page after Umami's script.js. Sends no personal details:
 * only which button, link or option was used, and where on the site.
 * Event names (as they appear in Umami > Events):
 *   Enquire click      any link to the enquiry form          {location, page, booth}
 *   Booth details      "Full details" / links to booth pages {booth, location, page}
 *   Call click         tel: links                            {location, page}
 *   Email click        mailto: links                         {location, page}
 *   Finance click      links to /finance/                    {location, page}
 *   Comparison click   links to the revenue share page       {location, page}
 *   Enquiry submit     enquiry form sent                     {business_type, interest, booth_model}
 *   FAQ open           an FAQ question expanded              {question, page}
 *   Calculator used    first change to the break-even calc   {}
 */
(function () {
  'use strict';
  var page = location.pathname;

  function track(name, data) {
    try {
      if (window.umami && typeof window.umami.track === 'function') window.umami.track(name, data);
    } catch (e) { /* analytics must never break the page */ }
  }

  // Where on the page an element sits: header, footer, or the nearest section's id/heading.
  function locationOf(el) {
    if (el.closest('header')) return 'header';
    if (el.closest('footer')) return 'footer';
    var sec = el.closest('section');
    if (!sec) return 'page';
    if (sec.id) return sec.id;
    var lbl = sec.getAttribute('aria-labelledby');
    return lbl ? lbl.replace(/-title$/, '') : 'section';
  }

  var BOOTHS = { 'standing-booth': 'Standing', 'sitting-booth': 'Sitting', 'open-style': 'Open Style' };
  function boothFrom(href, el) {
    var m = /\/booths\/([^/]+)\//.exec(href) || /[?&]model=([^&#]+)/.exec(href);
    if (m) return BOOTHS[m[1]] || BOOTHS[m[1] + '-booth'] || m[1];
    var card = el.closest('.card');
    var h = card && card.querySelector('h3');
    return h ? h.textContent.trim() : undefined;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var where = { location: locationOf(a), page: page };
    if (href.indexOf('tel:') === 0) return track('Call click', where);
    if (href.indexOf('mailto:') === 0) return track('Email click', where);
    if (href.indexOf('#enquire') !== -1) {
      var b = boothFrom(href, a);
      if (b) where.booth = b;
      return track('Enquire click', where);
    }
    if (/\/booths\/[^/]+\//.test(href)) {
      where.booth = boothFrom(href, a);
      return track('Booth details', where);
    }
    if (href.indexOf('/finance/') !== -1) return track('Finance click', where);
    if (href.indexOf('/photo-booth-revenue-share-vs-buying/') !== -1) return track('Comparison click', where);
  }, true);

  // Enquiry form: send only the dropdown choices, never what people type.
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.classList || !f.classList.contains('enquiry')) return;
    var val = function (n) { var x = f.elements[n]; return x && x.value ? x.value : undefined; };
    track('Enquiry submit', { business_type: val('business_type'), interest: val('interest'), booth_model: val('booth_model'), page: page });
  }, true);

  // FAQ questions opened.
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d || d.tagName !== 'DETAILS' || !d.open) return;
    var s = d.querySelector('summary');
    track('FAQ open', { question: s ? s.textContent.trim().slice(0, 100) : '', page: page });
  }, true);

  // Break-even calculator: once per visit, on the first change.
  var calc = document.getElementById('calc');
  if (calc) {
    var used = false;
    calc.addEventListener('input', function () { if (!used) { used = true; track('Calculator used', {}); } });
  }

})();
