'use strict';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  showView('loading-view');

  const rawId = getQueryParam('id');
  const id = rawId ? sanitizeId(rawId) : null;

  try {
    if (id) {
      // Certificate branch: load config + attendee data in parallel
      const results = await Promise.all([fetchConfig(), fetchAttendee(id)]);
      const config = results[0];
      const attendee = results[1];
      validateConfig(config);
      validateAttendee(attendee);
      applyConfigVars(config);
      document.title = attendee.name + ' \u2014 ' + attendee.workshop + ' Certificate | ' + config.org_name;
      renderCertificateView(config, attendee, id);
      wirePDFButton(config, attendee.certificate_id);
      injectSEOTags(config, attendee);
      injectJSONLD(config, attendee);
      showView('certificate-view');
    } else {
      // No id: show search view
      const config = await fetchConfig();
      validateConfig(config);
      applyConfigVars(config);
      if (config.site_title) {
        document.title = config.site_title;
      }
      renderSearchView(config);
      injectOrgJSONLD(config);
      showView('search-view');
    }
  } catch (err) {
    console.error('[App] init error:', err);
    showError(id);
  }
}

// === Config Loader ===

async function fetchConfig() {
  const res = await fetch('config/certificate.config.json');
  if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
  return res.json();
}

function validateConfig(config) {
  const required = ['org_name', 'primary_color', 'certificate_title'];
  for (const field of required) {
    if (!config[field]) throw new Error(`Invalid config: missing required field "${field}"`);
  }
}

// === Attendee Loader ===

async function fetchAttendee(id) {
  const response = await fetch('data/' + id + '.json');
  if (!response.ok) {
    throw new Error('Certificate not found for: ' + id);
  }
  return response.json();
}

function validateAttendee(attendee) {
  const required = ['certificate_id', 'name', 'email', 'workshop', 'date', 'date_iso'];
  for (let i = 0; i < required.length; i++) {
    if (!attendee[required[i]]) {
      throw new Error('Attendee data is missing required field: ' + required[i]);
    }
  }
}

// === Certificate Renderer ===

/**
 * Set an image src gracefully — hides the element if src is empty or the image 404s.
 * IMPORTANT: onerror must be assigned before src to catch immediate failures.
 */
function setImageGraceful(id, src) {
  var el = document.getElementById(id);
  if (!el) return;
  if (!src) {
    el.classList.add('hidden');
    return;
  }
  el.onerror = function () {
    this.classList.add('hidden');
  };
  el.src = src;
}

/**
 * Populate all certificate HTML slots from config and attendee data.
 * Requires all cert-* IDs to exist in index.html (created by plan 02-01).
 */
function renderCertificateView(config, attendee, id) {
  // Org header
  var orgNameEl = document.getElementById('cert-org-name');
  if (orgNameEl) {
    orgNameEl.textContent = config.org_name || '';
    orgNameEl.classList.toggle('hidden', !config.show_org_name);
  }

  var eventTitleEl = document.getElementById('cert-event-title');
  if (eventTitleEl) {
    eventTitleEl.textContent = config.event_title || '';
    eventTitleEl.classList.toggle('hidden', !config.event_title);
  }

  setImageGraceful('cert-logo', config.logo_url);
  var logoEl = document.getElementById('cert-logo');
  if (logoEl && config.org_name) logoEl.alt = config.org_name;

  // Title block
  var headingEl = document.getElementById('cert-heading-label');
  if (headingEl) headingEl.textContent = config.certificate_title || 'Certificate';

  // Body: text labels
  var preNameEl = document.getElementById('cert-pre-name-text');
  if (preNameEl) preNameEl.textContent = config.pre_name_text || '';

  var nameEl = document.getElementById('cert-name');
  if (nameEl) {
    // Populate the itemprop="name" span inside h1 for microdata
    var nameSpan = nameEl.querySelector('[itemprop="name"]');
    if (nameSpan) {
      nameSpan.textContent = attendee.name;
    } else {
      nameEl.textContent = attendee.name;
    }
  }

  var postNameEl = document.getElementById('cert-post-name-text');
  if (postNameEl) postNameEl.textContent = config.post_name_text || '';

  var workshopEl = document.getElementById('cert-workshop');
  if (workshopEl) workshopEl.textContent = attendee.workshop;

  // Description: show only when config.show_description is truthy AND attendee has description
  var descEl = document.getElementById('cert-description');
  if (descEl) {
    if (config.show_description && attendee.description) {
      descEl.textContent = attendee.description;
      descEl.classList.remove('hidden');
    } else {
      descEl.classList.add('hidden');
    }
  }

  // Footer: date
  var dateEl = document.getElementById('cert-date');
  if (dateEl) {
    dateEl.textContent = attendee.date;
    dateEl.setAttribute('datetime', attendee.date_iso);
  }

  var dateLabelEl = document.getElementById('cert-date-label');
  if (dateLabelEl) dateLabelEl.textContent = config.date_label || '';

  // Footer: seal (hidden if show_seal === false or seal_url missing)
  if (config.show_seal === false) {
    var sealEl = document.getElementById('cert-seal');
    if (sealEl) sealEl.classList.add('hidden');
  } else {
    setImageGraceful('cert-seal', config.seal_url);
  }

  // Footer: signature
  setImageGraceful('cert-signature', config.signature_url);

  var authorizedNameEl = document.getElementById('cert-authorized-name');
  if (authorizedNameEl) authorizedNameEl.textContent = config.signature_name || '';

  var sigLabelEl = document.getElementById('cert-sig-label');
  if (sigLabelEl) sigLabelEl.textContent = config.issued_by_label || '';

  var sealLabelEl = document.getElementById('cert-seal-label');
  if (sealLabelEl) sealLabelEl.textContent = config.seal_label || '';

  // QR code: encode full certificate URL for one-tap verification
  if (config.show_qr !== false) {
    generateQR(config, id);
  } else {
    var qrEl = document.getElementById('cert-qr');
    if (qrEl) qrEl.parentNode.classList.add('hidden');
  }
}

/**
 * Generate a QR code inside #cert-qr that encodes the certificate URL.
 * Uses qrcode.js (window.QRCode) loaded from CDN.
 * Encoded URL = config.org_website if set, otherwise falls back to window.location.href.
 */
function generateQR(config, id) {
  var container = document.getElementById('cert-qr');
  if (!container || typeof QRCode === 'undefined') return;
  container.innerHTML = '';
  var base = (config.org_website && config.org_website.trim()) ? config.org_website.trim() : window.location.origin + window.location.pathname;
  var qrUrl = id ? (base + (base.indexOf('?') === -1 ? '?' : '&') + 'id=' + encodeURIComponent(id)) : base;
  new QRCode(container, {
    text: qrUrl,
    width: 68,
    height: 68,
    colorDark: config.primary_color || '#1a2e4a',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
}

// === PDF Download ===

function wirePDFButton(config, certId) {
  var btn = document.getElementById('download-btn');
  if (!btn) return;

  var originalHTML = btn.innerHTML;

  btn.addEventListener('click', function () {
    if (typeof html2pdf === 'undefined') {
      alert('PDF library is still loading. Please try again in a moment.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Generating…';

    var element = document.getElementById('certificate');
    var noPrint = document.querySelectorAll('.no-print');
    noPrint.forEach(function (el) { el.classList.add('invisible'); });

    var opt = {
      margin:      config.pdf_margin != null ? config.pdf_margin : 0,
      filename:    (config.pdf_filename_prefix || 'certificate') + '-' + certId + '.pdf',
      image:       { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF:       {
        unit:        'mm',
        format:      config.pdf_format || 'a4',
        orientation: config.pdf_orientation || 'landscape'
      }
    };

    html2pdf().set(opt).from(element).save().then(function () {
      noPrint.forEach(function (el) { el.classList.remove('invisible'); });
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    });
  });
}

// === Search View ===

function renderSearchView(config) {
  var logoEl = document.getElementById('search-logo');
  if (logoEl) {
    logoEl.src = config.logo_url || '';
    logoEl.alt = config.org_name || '';
    if (!config.logo_url) logoEl.classList.add('hidden');
    logoEl.onerror = function () { this.classList.add('hidden'); };
  }

  var orgNameEl = document.getElementById('search-org-name');
  if (orgNameEl) orgNameEl.textContent = config.org_name || '';

  var headlineEl = document.getElementById('search-headline');
  if (headlineEl) headlineEl.textContent = config.search_headline || config.org_name || '';

  var subtextEl = document.getElementById('search-subtext');
  if (subtextEl) subtextEl.textContent = config.search_subtext || '';

  var placeholderEl = document.getElementById('lookup-input');
  if (placeholderEl) placeholderEl.placeholder = config.search_placeholder || 'your@email.com';

  var btnEl = document.getElementById('lookup-btn');
  if (btnEl) btnEl.textContent = config.search_button || 'Find My Certificate';

  var noteEl = document.getElementById('search-footer-note');
  if (noteEl) noteEl.textContent = config.search_footer_note || '';

  // Wire search
  if (btnEl) btnEl.addEventListener('click', handleSearch);
  var inputEl = document.getElementById('lookup-input');
  if (inputEl) inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') handleSearch();
  });
}

function handleSearch() {
  var input = document.getElementById('lookup-input');
  if (!input) return;
  var value = input.value.trim();
  if (!value) {
    input.focus();
    return;
  }
  var id = sanitizeId(value);
  window.location.href = '?id=' + encodeURIComponent(id);
}

// === SEO & Structured Data ===

function injectSEOTags(config, attendee) {
  var pageUrl     = window.location.href;
  var title       = attendee.name + ' \u2014 ' + attendee.workshop + ' Certificate | ' + config.org_name;
  var description = attendee.name + ' successfully completed \u201c' + attendee.workshop + '\u201d on ' + attendee.date + '. Issued by ' + config.org_name + '.';
  var image       = config.og_image_url
    ? new URL(config.og_image_url, window.location.origin).href
    : (config.logo_url ? new URL(config.logo_url, window.location.origin).href : '');

  var canonical = document.getElementById('canonical-tag');
  if (canonical) canonical.setAttribute('href', pageUrl);

  document.title = title;
  var metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', description);

  setMetaContent('og-title',       title);
  setMetaContent('og-description', description);
  setMetaContent('og-url',         pageUrl);
  setMetaContent('og-image',       image);
  setMetaContent('og-site-name',   config.org_name || '');

  setMetaContent('tw-title',       title);
  setMetaContent('tw-description', description);
  setMetaContent('tw-image',       image);
  setMetaContent('tw-site',        config.twitter_handle || '');
}

function setMetaContent(id, value) {
  var el = document.getElementById(id);
  if (el) el.setAttribute('content', value);
}

function injectJSONLD(config, attendee) {
  var schema = {
    '@context': 'https://schema.org',
    '@type':    'EducationalOccupationalCredential',
    'name':     attendee.workshop + ' \u2014 Certificate of Completion',
    'description': attendee.description || (attendee.name + ' completed ' + attendee.workshop + '.'),
    'credentialCategory': 'Certificate of Completion',
    'dateCreated':  attendee.date_iso,
    'url':          window.location.href,
    'identifier':   attendee.certificate_id,
    'recognizedBy': {
      '@type': 'Organization',
      'name':  config.org_name,
      'url':   config.org_website || '',
      'logo':  config.logo_url ? new URL(config.logo_url, window.location.origin).href : ''
    },
    'about': {
      '@type': 'Person',
      'name':  attendee.name,
      'email': attendee.email
    }
  };
  var el = document.getElementById('json-ld-block');
  if (el) el.textContent = JSON.stringify(schema, null, 2);
}

function injectOrgJSONLD(config) {
  var schema = {
    '@context':    'https://schema.org',
    '@type':       'Organization',
    'name':        config.org_name,
    'url':         config.org_website || window.location.origin,
    'description': config.org_tagline || ''
  };
  if (config.logo_url) {
    schema.logo = new URL(config.logo_url, window.location.origin).href;
  }
  var el = document.getElementById('json-ld-block');
  if (el) el.textContent = JSON.stringify(schema, null, 2);
}

// === Error View ===

function showError(id) {
  var msgEl = document.getElementById('error-message');
  var detailEl = document.getElementById('error-detail');
  if (id && msgEl) {
    msgEl.textContent = 'Certificate not found.';
    if (detailEl) {
      detailEl.textContent = 'We could not find a certificate for: ' + id;
      detailEl.classList.remove('hidden');
    }
  }
  var retryBtn = document.getElementById('retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      window.location.href = './';
    });
  }
  showView('error-view');
}

// === CSS Variable Injection ===

function applyConfigVars(config) {
  const r = document.documentElement.style;

  // Colors
  r.setProperty('--primary-color',    config.primary_color    || '#1a2e4a');
  r.setProperty('--secondary-color',  config.secondary_color  || '#c8a951');
  r.setProperty('--background-color', config.background_color || '#ffffff');
  r.setProperty('--text-color',       config.text_color       || '#333333');
  r.setProperty('--muted-color',      config.muted_color      || '#777777');

  // Border
  r.setProperty('--border-color', config.border_color || '#c8a951');
  r.setProperty('--border-width', config.border_width || '7px');

  // Fonts
  r.setProperty('--font-heading', config.font_heading || "'Playfair Display', Georgia, serif");
  r.setProperty('--font-body',    config.font_body    || "'Lato', 'Helvetica Neue', sans-serif");

  // Image URLs — only set when the config field is non-empty
  if (config.logo_url)      r.setProperty('--logo-url',      `url(${config.logo_url})`);
  if (config.seal_url)      r.setProperty('--seal-url',      `url(${config.seal_url})`);
  if (config.signature_url) r.setProperty('--signature-url', `url(${config.signature_url})`);
}

// === SPA View System ===

function showView(activeId) {
  const viewIds = ['loading-view', 'search-view', 'certificate-view', 'error-view'];
  viewIds.forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== activeId);
  });
}

// === URL Utilities ===

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function sanitizeId(email) {
  return email
    .toLowerCase()
    .trim()
    .replace(/\+/g, '-plus-')
    .replace(/@/g, '-at-')
    .replace(/\./g, '-')
    .replace(/[^a-z0-9\-]/g, '');
}
