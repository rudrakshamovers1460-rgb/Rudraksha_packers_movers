/**
 * Rudraksha Packers & Movers - Pure Direct 1-Click Native Installer
 * Fires Chrome's native Android install dialog directly without any modals or extra steps.
 */

(function () {
  'use strict';

  // 1. Register Service Worker with auto-update
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker active:', reg.scope);
          if (reg.update) reg.update();
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const isAdmin = window.location.pathname.includes('admin.html');
  const appName = isAdmin ? 'Rudraksha Admin Control' : 'Rudraksha Packers & Movers';
  const appDesc = isAdmin ? 'Live Fleets, Bookings & Rates' : 'Fast Shifting & Parcel Delivery App';
  const appIcon = 'icon-192.png';

  let deferredPrompt = null;

  // Listen for native install prompt event IMMEDIATELY
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Native 1-Click prompt is ready!');

    // Show bottom banner
    const banner = document.getElementById('pwaBottomBanner');
    if (banner && !sessionStorage.getItem('pwa_banner_dismissed')) {
      banner.classList.add('pwa-show');
    }

    // If a button was clicked while waiting for prompt, trigger it immediately!
    if (window._pwaWaitingForPrompt) {
      window._pwaWaitingForPrompt = false;
      handleDirectInstall();
    }
  });

  // App Installed Event
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App successfully installed!');
    deferredPrompt = null;
    const banner = document.getElementById('pwaBottomBanner');
    if (banner) banner.classList.remove('pwa-show');
    const toast = document.getElementById('pwaToast');
    if (toast) {
      toast.innerText = '🎉 Rudraksha App Installed Successfully!';
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3500);
    }
  });

  // If already running inside standalone app, exit early
  if (isStandalone) {
    console.log('[PWA] Running inside standalone installed app');
    return;
  }

  // 2. Initialize UI (Only clean bottom banner and minimal iOS sheet if on iPhone)
  function initPwaUI() {
    // Bottom Banner
    const banner = document.createElement('div');
    banner.id = 'pwaBottomBanner';
    banner.className = 'pwa-bottom-banner';
    banner.innerHTML = `
      <div class="pwa-banner-left">
        <img src="${appIcon}" alt="App Icon" class="pwa-app-icon" />
        <div class="pwa-banner-info">
          <div class="pwa-banner-title">
            <span>${appName}</span>
            <span class="pwa-badge-verified">APP</span>
          </div>
          <p class="pwa-banner-desc">${appDesc}</p>
        </div>
      </div>
      <div class="pwa-banner-actions">
        <button id="pwaBannerInstallBtn" class="pwa-btn-install-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
          Install
        </button>
        <button id="pwaBannerDismissBtn" class="pwa-btn-dismiss" title="Close">&times;</button>
      </div>
    `;
    document.body.appendChild(banner);

    // Minimal Toast for Feedback
    const toast = document.createElement('div');
    toast.id = 'pwaToast';
    toast.className = 'pwa-simple-toast';
    document.body.appendChild(toast);

    // Minimal iOS Sheet ONLY for iPhone (since Safari lacks direct beforeinstallprompt)
    if (isIOS) {
      const iosSheet = document.createElement('div');
      iosSheet.id = 'pwaIosSheet';
      iosSheet.className = 'pwa-universal-modal-backdrop';
      iosSheet.innerHTML = `
        <div class="pwa-universal-modal" style="max-width:380px;">
          <h4 style="font-weight:800; margin-bottom:6px; color:#0f172a;">Install ${appName}</h4>
          <p style="font-size:0.86rem; color:#64748b; margin-bottom:16px;">iPhone Safari me install karne ke liye:</p>
          <div style="background:#f8fafc; padding:12px; border-radius:12px; border:1px solid #e2e8f0; text-align:left; font-size:0.88rem; line-height:1.5;">
            1. Safari me niche <strong>Share (⬆️)</strong> dabayein.<br>
            2. <strong>'Add to Home Screen' (➕)</strong> chunein.<br>
            3. Upar <strong>'Add'</strong> par click karein.
          </div>
          <button type="button" onclick="document.getElementById('pwaIosSheet').classList.remove('pwa-active')" style="margin-top:16px; width:100%; padding:10px; background:#f1f5f9; border:none; border-radius:10px; font-weight:700; color:#475569;">OK</button>
        </div>
      `;
      document.body.appendChild(iosSheet);
    }

    // Event Bindings
    const bannerInstallBtn = document.getElementById('pwaBannerInstallBtn');
    const bannerDismissBtn = document.getElementById('pwaBannerDismissBtn');

    if (bannerInstallBtn) bannerInstallBtn.addEventListener('click', handleDirectInstall);
    if (bannerDismissBtn) {
      bannerDismissBtn.addEventListener('click', () => {
        banner.classList.remove('pwa-show');
        sessionStorage.setItem('pwa_banner_dismissed', 'true');
      });
    }

    // Bind all install trigger buttons
    document.querySelectorAll('.pwa-install-trigger, #btnInstallApp, #btnInstallAppNav, #btnAdminInstall, .btn-mobile-nav-app').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        handleDirectInstall();
      });
    });

    // Auto-show bottom banner after 1 second
    setTimeout(() => {
      if (!sessionStorage.getItem('pwa_banner_dismissed')) {
        banner.classList.add('pwa-show');
      }
    }, 1000);

    // Auto close navbar on link click
    document.querySelectorAll('.main-navbar .nav-link-custom, .main-navbar a').forEach((link) => {
      link.addEventListener('click', () => {
        const navCollapse = document.getElementById('navbarContent');
        const hamburgerBtn = document.getElementById('mainHamburgerBtn');
        if (navCollapse && navCollapse.classList.contains('show')) {
          if (window.bootstrap && window.bootstrap.Collapse) {
            const bs = window.bootstrap.Collapse.getInstance(navCollapse) || new window.bootstrap.Collapse(navCollapse);
            if (bs) bs.hide();
          } else {
            navCollapse.classList.remove('show');
          }
          if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  // 3. Direct 1-Click Installation
  window.triggerPwaInstall = handleDirectInstall;
  async function handleDirectInstall() {
    // If iOS Safari: Show minimal share helper
    if (isIOS) {
      const sheet = document.getElementById('pwaIosSheet');
      if (sheet) sheet.classList.add('pwa-active');
      return;
    }

    // 1. If deferredPrompt is ready: Trigger Native Android Prompt DIRECTLY!
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        console.log('[PWA] User response:', choice.outcome);
        if (choice.outcome === 'accepted') {
          const banner = document.getElementById('pwaBottomBanner');
          if (banner) banner.classList.remove('pwa-show');
        }
        deferredPrompt = null;
        return;
      } catch (err) {
        console.warn('[PWA] Prompt error:', err);
      }
    }

    // 2. If prompt not ready yet, wait up to 2 seconds for it
    showToast('Connecting to app installer...');
    window._pwaWaitingForPrompt = true;

    const arrived = await waitForPrompt(2000);
    if (arrived && deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          const banner = document.getElementById('pwaBottomBanner');
          if (banner) banner.classList.remove('pwa-show');
        }
        deferredPrompt = null;
        return;
      } catch (err) {}
    }

    // 3. If deferredPrompt still didn't fire, explain the technical requirement clearly:
    if (!window.isSecureContext) {
      showToast('⚠️ Direct 1-click install requires HTTPS (Secure link). Please use the live HTTPS link!');
    } else {
      showToast('App is ready! Tap Chrome Menu (⋮) ➔ Install app');
    }
  }

  function waitForPrompt(timeoutMs) {
    return new Promise((resolve) => {
      if (deferredPrompt) return resolve(true);
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const listener = () => {
        clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt', listener);
        resolve(true);
      };
      window.addEventListener('beforeinstallprompt', listener, { once: true });
    });
  }

  function showToast(msg) {
    const toast = document.getElementById('pwaToast');
    if (toast) {
      toast.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3500);
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPwaUI);
  } else {
    initPwaUI();
  }
})();
