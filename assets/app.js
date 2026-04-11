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
      if (config.site_title) {
        document.title = config.site_title;
      }
      renderCertificateView(config, attendee);
      showView('certificate-view');
    } else {
      // No id: show search view
      const config = await fetchConfig();
      validateConfig(config);
      applyConfigVars(config);
      if (config.site_title) {
        document.title = config.site_title;
      }
      showView('search-view');
    }
  } catch (err) {
    console.error('[App] init error:', err);
    showView('error-view');
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
