/**
 * =============================================================================
 * LIMRA RESTAURANT POS — AUDIO SYNTHESIS & TOAST ALERTS (pos/audio-alerts.js)
 * =============================================================================
 * 
 * Provides:
 * 1. Web Audio multi-oscillator harmonic chime synthesis.
 * 2. SpeechSynthesis vocal announcements for multi-round dining orders.
 * 3. Proactive business order notifications (Website & Table QR only).
 * 4. Strict cashier workstation silence & deduplication sets.
 */

import { posEvents } from './state.js';

// ── Strict Notification Filtering & Source Isolation Sets ──────────────
export const notifiedBusinessOrderIds = new Set();
export const cashierCreatedOrderIds = new Set();

// Persistent AudioContext with browser autoplay-policy unlocking
let _audioCtx = null;
let _audioUnlocked = false;
let _fallbackAudioEl = null;
let _tableRoundAudioEl = null;

// Routing callback for clicking on business notifications
let _notificationNavigationHandler = null;

export function setNotificationNavigationHandler(handler) {
  _notificationNavigationHandler = handler;
}

export function getAudioCtx() {
  if (!_audioCtx) {
    if (typeof window !== 'undefined') {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) {
        _audioCtx = new Ctor({ latencyHint: 'interactive' });
      }
    }
  }
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

// Generate an audible WAV chime for fallback playback
export function generateChimeWavUri() {
  const sampleRate = 22050;
  const duration = 1.2;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new Uint8Array(44 + numSamples * 2);
  const view = new DataView(buffer.buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    
    // Note 1 (0 to 0.5s): G5 (784Hz) + C6 (1046.5Hz)
    if (t < 0.6) {
      const env1 = Math.exp(-t * 7);
      sample += Math.sin(2 * Math.PI * 783.99 * t) * 0.45 * env1;
      sample += Math.sin(2 * Math.PI * 1046.50 * t) * 0.3 * env1;
    }
    // Note 2 (0.18s to 1.2s): E6 (1318.5Hz) + G6 (1568Hz) + C7 (2093Hz)
    if (t >= 0.18) {
      const t2 = t - 0.18;
      const env2 = Math.exp(-t2 * 5.5);
      sample += Math.sin(2 * Math.PI * 1318.51 * t2) * 0.5 * env2;
      sample += Math.sin(2 * Math.PI * 1567.98 * t2) * 0.35 * env2;
      sample += Math.sin(2 * Math.PI * 2093.00 * t2) * 0.28 * Math.exp(-t2 * 9);
    }

    const val = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, val < 0 ? val * 0x8000 : val * 0x7FFF, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + (typeof btoa !== 'undefined' ? btoa(binary) : '');
}

export function getFallbackAudioElement() {
  if (!_fallbackAudioEl && typeof Audio !== 'undefined') {
    try {
      _fallbackAudioEl = new Audio(generateChimeWavUri());
      _fallbackAudioEl.preload = 'auto';
      _fallbackAudioEl.volume = 0.9;
    } catch (e) {
      console.warn('Fallback audio creation error:', e);
    }
  }
  return _fallbackAudioEl;
}

export function warmUpAudio() {
  try {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    _audioUnlocked = true;
    const el = getFallbackAudioElement();
    if (el) {
      el.load();
    }
  } catch (e) {}
}

export function initAudioUnlockListeners() {
  if (typeof window === 'undefined') return;
  const unlock = async () => {
    try {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume();
      }
      _audioUnlocked = true;
      const el = getFallbackAudioElement();
      if (el) {
        el.load();
      }
    } catch (e) {
      console.warn('Audio unlock warning:', e);
    }
  };

  ['click', 'touchstart', 'touchend', 'keydown', 'pointerdown', 'mousedown'].forEach(evt => {
    window.addEventListener(evt, unlock, { once: false, passive: true });
  });
}

// ── Voice Speech Synthesis Announcements ──────────────────────────────
export function isVoiceAnnouncementEnabled() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem('limra_voice_announcements') !== 'false';
}

export function setVoiceAnnouncementEnabled(enabled) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('limra_voice_announcements', enabled ? 'true' : 'false');
}

export function speakTableRoundAnnouncement(roundNumber, tableNumber) {
  if (!isVoiceAnnouncementEnabled()) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  try {
    window.speechSynthesis.cancel();
    const cleanTable = String(tableNumber || '').replace(/table/i, '').trim() || '—';
    const text = `Attention! Table ${cleanTable}, Round ${roundNumber} order received!`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.15;
    utterance.volume = 1.0;
    utterance.lang = 'en-IN';

    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      const enVoice = voices.find(v => v.lang.includes('en-IN') || v.lang.includes('en-US') || v.lang.includes('en-GB') || v.default);
      if (enVoice) utterance.voice = enVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[SpeechSynthesis] Error:', err);
  }
}

// ── Table Round Chime ─────────────────────────────────────────────────
export function generateTableRoundChimeWavUri(roundNumber = 2) {
  const sampleRate = 22050;
  const duration = 1.5;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new Uint8Array(44 + numSamples * 2);
  const view = new DataView(buffer.buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    // Burst 1: Urgent 2-tone ping (0.0s to 0.4s) - D6 (1174.66Hz) + A6 (1760Hz)
    if (t < 0.45) {
      const env1 = Math.exp(-t * 9);
      sample += Math.sin(2 * Math.PI * 1174.66 * t) * 0.5 * env1;
      sample += Math.sin(2 * Math.PI * 1760.00 * t) * 0.35 * env1;
    }

    // Burst 2: Rapid rising escalation (0.16s to 0.7s) - F#6 (1479.98Hz) + D7 (2349.32Hz)
    if (t >= 0.16 && t < 0.75) {
      const t2 = t - 0.16;
      const env2 = Math.exp(-t2 * 8);
      sample += Math.sin(2 * Math.PI * 1479.98 * t2) * 0.55 * env2;
      sample += Math.sin(2 * Math.PI * 2349.32 * t2) * 0.4 * env2;
    }

    // Burst 3 (Round 3+ or High Urgency Alert): Resonant High Bell Ping (0.35s to 1.5s)
    if (t >= 0.35) {
      const t3 = t - 0.35;
      const env3 = Math.exp(-t3 * 4.5);
      sample += Math.sin(2 * Math.PI * 2093.00 * t3) * 0.45 * env3;
      sample += Math.sin(2 * Math.PI * 2793.83 * t3) * 0.3 * Math.exp(-t3 * 7);
      sample += Math.sin(2 * Math.PI * 1046.50 * t3) * 0.25 * env3;
    }

    const val = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, val < 0 ? val * 0x8000 : val * 0x7FFF, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + (typeof btoa !== 'undefined' ? btoa(binary) : '');
}

export function getTableRoundFallbackAudioElement(roundNumber = 2) {
  if (!_tableRoundAudioEl && typeof Audio !== 'undefined') {
    try {
      _tableRoundAudioEl = new Audio(generateTableRoundChimeWavUri(roundNumber));
      _tableRoundAudioEl.preload = 'auto';
      _tableRoundAudioEl.volume = 1.0;
    } catch (e) {}
  }
  return _tableRoundAudioEl;
}

export async function playTableRoundChime(roundNumber = 2, tableNumber = '—', order = null, isTest = false) {
  const roundNum = Number(roundNumber) || 2;
  const tNum = String(tableNumber || '—');

  // 1. Web Audio API (High-energy multi-harmonic Table Round Chime)
  try {
    const ctx = getAudioCtx();
    if (ctx) {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      if (ctx.state === 'running') {
        const now = ctx.currentTime;

        const playBell = (freq, startTime, duration, volume = 0.6, type = 'sine') => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.001, startTime);
          gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(startTime);
          osc.stop(startTime + duration);
        };

        // Note 1: High alert bell D6 (1174.66Hz) + A6 (1760Hz)
        playBell(1174.66, now, 0.45, 0.65, 'triangle');
        playBell(1760.00, now + 0.01, 0.45, 0.50, 'sine');

        // Note 2: Rising chime F#6 (1479.98Hz) + D7 (2349.32Hz)
        playBell(1479.98, now + 0.14, 0.55, 0.70, 'triangle');
        playBell(2349.32, now + 0.15, 0.60, 0.55, 'sine');

        // Note 3: Escalation A7 (3520Hz) sparkle + High C7
        playBell(2093.00, now + 0.28, 0.80, 0.60, 'triangle');
        playBell(2637.02, now + 0.30, 0.90, 0.45, 'sine');

        // Extra burst for Round 3+
        if (roundNum >= 3) {
          playBell(2349.32, now + 0.45, 0.60, 0.65, 'sine');
          playBell(3135.96, now + 0.46, 0.70, 0.40, 'triangle');
        }
      }
    }
  } catch (err) {
    console.warn('Web Audio table round chime error:', err);
  }

  // 2. HTML5 Audio fallback
  try {
    const el = getTableRoundFallbackAudioElement(roundNum);
    if (el) {
      el.currentTime = 0;
      el.play().catch(() => {});
    }
  } catch (e) {}

  // 3. Voice Speech Synthesis Announcement
  speakTableRoundAnnouncement(roundNum, tNum);

  posEvents.emit('audio:tableround', { roundNumber: roundNum, tableNumber: tNum });

  if (isTest) {
    showAdminToast(`🔔 Tested Table ${tNum} Round ${roundNum} Sound & Voice!`, 'success');
  }
}

// ── Standard Chime ────────────────────────────────────────────────────
export async function playNotificationChime(isTest = false, meta = null) {
  if (meta && meta.isTable && meta.roundNumber >= 2) {
    return playTableRoundChime(meta.roundNumber, meta.tableNumber, meta.order, isTest);
  }

  let playedSuccessfully = false;

  // Method 1: Web Audio API (Multi-oscillator harmonic chime)
  try {
    const ctx = getAudioCtx();
    if (ctx) {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      if (ctx.state === 'running') {
        const now = ctx.currentTime;

        const playTone = (freq, startTime, duration, volume = 0.5, type = 'triangle') => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, startTime);
          
          gain.gain.setValueAtTime(0.001, startTime);
          gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.start(startTime);
          osc.stop(startTime + duration);
        };

        // Note 1: G5 (784Hz) + C6 (1046Hz)
        playTone(783.99, now, 0.50, 0.55, 'triangle');
        playTone(1046.50, now + 0.02, 0.55, 0.40, 'sine');
        
        // Note 2: E6 (1318.5Hz) + G6 (1568Hz)
        playTone(1318.51, now + 0.18, 0.70, 0.55, 'triangle');
        playTone(1567.98, now + 0.20, 0.75, 0.40, 'sine');
        
        // Note 3: High C7 sparkle (2093Hz)
        playTone(2093.00, now + 0.35, 0.90, 0.35, 'sine');

        playedSuccessfully = true;
      }
    }
  } catch (e) {
    console.warn('Web Audio chime error:', e);
  }

  // Method 2: HTML5 Audio Fallback
  try {
    const audioEl = getFallbackAudioElement();
    if (audioEl) {
      audioEl.currentTime = 0;
      const playPromise = audioEl.play();
      if (playPromise !== undefined) {
        playPromise.then(() => { playedSuccessfully = true; }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('HTML5 audio fallback error:', e);
  }

  posEvents.emit('audio:chime', { playedSuccessfully });

  if (isTest) {
    showAdminToast('🔊 Standard notification sound test playing!', 'info');
  }
}

export function testNotificationSound() {
  playNotificationChime(true);
}

export function testTableRoundSound(roundNumber = 2, tableNumber = '04') {
  playTableRoundChime(roundNumber, tableNumber, null, true);
}

// ── Toast Container & Visual Alerts ───────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initToastContainer() {
  if (typeof document === 'undefined') return null;
  let container = document.getElementById('dashboard-toast-container');
  if (!container && document.body) {
    container = document.createElement('div');
    container.id = 'dashboard-toast-container';
    container.className = 'fixed top-6 right-6 z-[200] flex flex-col gap-3 w-80 max-w-full pointer-events-none';
    document.body.appendChild(container);
  }
  return container;
}

export function showAdminToast(message, type = 'error') {
  // STRICT POS WORKSTATION POLICY: Routine operations happen silently.
  // ONLY genuine validation errors, operational warnings, and security alerts are displayed.
  if (type !== 'error' && type !== 'warning' && type !== 'critical' && type !== 'danger') {
    return null;
  }

  if (typeof document === 'undefined') return null;
  initToastContainer();
  const container = document.getElementById('dashboard-toast-container');
  if (!container) return null;

  const toast = document.createElement('div');
  toast.className = 'p-4 rounded-2xl border shadow-xl flex items-center justify-between gap-3 transition-all duration-500 translate-x-80 opacity-0 pointer-events-auto cursor-pointer backdrop-blur-md';
  
  toast.style.background = 'rgba(255, 255, 255, 0.98)';
  toast.style.borderColor = type === 'warning' ? 'rgba(245, 158, 11, 0.6)' : 'rgba(239, 68, 68, 0.6)';
  toast.style.color = '#1e293b';
  toast.style.fontSize = '0.88rem';
  toast.style.fontWeight = '600';
  toast.style.boxShadow = '0 12px 28px -4px rgba(239, 68, 68, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)';
  
  const icon = type === 'warning' ? '⚠️' : '🚨';
  toast.innerHTML = `
    <div style="display:flex; align-items:center; gap:0.6rem;">
      <span style="font-size:1.25rem;">${icon}</span>
      <span style="color:#0f172a; line-height:1.4;">${escapeHtml(message)}</span>
    </div>
    <button style="background:none; border:none; color:#64748b; cursor:pointer; font-weight:bold; font-size:1.1rem; padding:0.2rem 0.4rem;" aria-label="Close">✕</button>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.remove('translate-x-80', 'opacity-0');
  }, 50);
  
  const close = () => {
    toast.classList.add('translate-x-80', 'opacity-0');
    setTimeout(() => toast.remove(), 400);
  };
  
  toast.addEventListener('click', close);
  toast.querySelector('button')?.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  
  setTimeout(close, 5000);
  posEvents.emit('toast:shown', { message, type });
  return toast;
}

export function showBusinessNotification(payload) {
  if (!payload || !payload.type) return null;
  if (typeof document === 'undefined') return null;
  initToastContainer();
  const container = document.getElementById('dashboard-toast-container');
  if (!container) return null;

  const isWebsite = payload.type === 'website';
  const notif = document.createElement('div');
  notif.className = `pos-business-notif ${isWebsite ? 'pos-business-notif-website' : 'pos-business-notif-table'} transition-all duration-500 translate-x-80 opacity-0`;
  notif.setAttribute('role', 'alert');
  notif.setAttribute('data-order-id', String(payload.orderId || ''));
  notif.setAttribute('data-notif-type', payload.type);

  const titleText = isWebsite ? 'NEW WEBSITE ORDER RECEIVED' : 'NEW TABLE QR ORDER RECEIVED';
  const badgeHtml = isWebsite
    ? `<span class="pos-notif-badge pos-notif-badge-website">🌐 Website</span>`
    : `<span class="pos-notif-badge pos-notif-badge-table">🪑 Table QR</span>`;

  const orderNumStr = payload.orderNumber || (payload.orderId ? `#ORD-${String(payload.orderId).slice(-4)}` : '#ORD');
  const amountStr = `₹${Math.round(payload.amount || 0)}`;

  let detailsHtml = '';
  if (isWebsite) {
    const custName = escapeHtml(payload.customerName || 'Online Customer');
    const ordType = escapeHtml(payload.orderType || 'Delivery');
    detailsHtml = `
      <div class="pos-notif-row">
        <span class="pos-notif-label">Order Number:</span>
        <span class="pos-notif-value">${escapeHtml(orderNumStr)}</span>
      </div>
      <div class="pos-notif-row">
        <span class="pos-notif-label">Customer Name:</span>
        <span class="pos-notif-value">${custName}</span>
      </div>
      <div class="pos-notif-row">
        <span class="pos-notif-label">Order Type:</span>
        <span class="pos-notif-value">${ordType}</span>
      </div>
      <div class="pos-notif-row">
        <span class="pos-notif-label">Total Amount:</span>
        <span class="pos-notif-price">${amountStr}</span>
      </div>
    `;
  } else {
    const tableStr = escapeHtml(payload.tableNumber || 'Table —');
    const itemsStr = `${payload.itemCount || 1} ${payload.itemCount === 1 ? 'item' : 'items'}`;
    detailsHtml = `
      <div class="pos-notif-row">
        <span class="pos-notif-label">Table Number:</span>
        <span class="pos-notif-value" style="color:#2563eb; font-weight:800;">${tableStr}</span>
      </div>
      <div class="pos-notif-row">
        <span class="pos-notif-label">Order Number:</span>
        <span class="pos-notif-value">${escapeHtml(orderNumStr)}</span>
      </div>
      <div class="pos-notif-row">
        <span class="pos-notif-label">Items Count:</span>
        <span class="pos-notif-value">${itemsStr}</span>
      </div>
      <div class="pos-notif-row">
        <span class="pos-notif-label">Total Amount:</span>
        <span class="pos-notif-price">${amountStr}</span>
      </div>
    `;
  }

  notif.innerHTML = `
    <div class="pos-notif-header">
      <div class="pos-notif-badge-group">
        ${badgeHtml}
        <span class="pos-notif-title">${isWebsite ? '🛍️' : '🔔'} ${titleText}</span>
      </div>
      <button class="pos-notif-close-btn" aria-label="Dismiss">✕</button>
    </div>
    <div class="pos-notif-body">
      ${detailsHtml}
    </div>
    <div class="pos-notif-footer-hint">
      <span>👆 Click to open ${isWebsite ? 'order' : 'table'}</span>
    </div>
  `;

  container.appendChild(notif);

  setTimeout(() => {
    notif.classList.remove('translate-x-80', 'opacity-0');
  }, 40);

  const closeNotif = () => {
    notif.classList.add('translate-x-80', 'opacity-0');
    setTimeout(() => notif.remove(), 450);
  };

  notif.querySelector('.pos-notif-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeNotif();
  });

  notif.addEventListener('click', (e) => {
    if (e.target.closest('.pos-notif-close-btn')) return;
    if (typeof _notificationNavigationHandler === 'function') {
      _notificationNavigationHandler(payload);
    } else {
      posEvents.emit('navigate:order', payload);
    }
    closeNotif();
  });

  setTimeout(() => {
    if (notif.parentNode) closeNotif();
  }, 10000);

  posEvents.emit('notification:business', payload);
  return notif;
}

export function showDashboardToast(title, msg, type = 'info', orderId = null) {
  if (type === 'table_round' || (title && /table/i.test(title))) {
    const tableMatch = (title + ' ' + msg).match(/table\s*(\w+)/i);
    const amountMatch = (title + ' ' + msg).match(/₹\s*([\d,]+)/);
    const amt = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
    showBusinessNotification({
      type: 'table_qr',
      orderId,
      orderNumber: orderId ? `#ORD-${String(orderId).slice(-4)}` : '#ORD',
      tableNumber: tableMatch ? `Table ${tableMatch[1]}` : 'Table —',
      itemCount: 1,
      amount: amt
    });
  } else if (orderId) {
    showBusinessNotification({
      type: 'website',
      orderId,
      orderNumber: `#ORD-${String(orderId).slice(-4)}`,
      customerName: 'Online Customer',
      orderType: 'Delivery',
      amount: 0
    });
  }
}
