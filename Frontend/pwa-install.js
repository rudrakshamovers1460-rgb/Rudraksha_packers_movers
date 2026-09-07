/**
 * Rudraksha Packers & Movers - PWA Universal Install Handler
 * Supports Android, Chrome, Edge, PC, and iOS (iPhone/iPad)
 */

(function () {
  'use strict';

  // 1. Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }

  // Detect context
  const isAdmin = window.location.pathname.includes('admin.html');
  const appName = isAdmin ? 'Rudraksha Admin Panel' : 'Rudraksha Packers & Movers';
  const appDesc = isAdmin ? 'Live Orders & Fleets Control' : 'Fast Booking & Live Tracking App';
  const appIcon = 'favicon.png';

  // State
  let deferredPrompt = null;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // If already installed and opened as app, don't show prompt banners
  if (isStandalone) {
    console.log('[PWA] Running in standalone app mode');
    return;
  }

  // Create UI elements once DOM is ready
  function initPwaUI() {
    // 1. Create Bottom Banner
    const banner = document.createElement('div');
    banner.id = 'pwaBottomBanner';
    banner.className = 'pwa-bottom-banner';
    banner.innerHTML = `
      <div class="pwa-banner-left">
        <img src="${appIcon}" alt="App Icon" class="pwa-app-icon" />
        <div class="pwa-banner-info">
          <div class="pwa-banner-title">
            <span>${appName}</span>
            <span class="pwa-badge-verified">OFFICIAL</span>
          </div>
          <p class="pwa-banner-desc">${appDesc}</p>
        </div>
      </div>
      <div class="pwa-banner-actions">
        <button id="pwaBannerInstallBtn" class="pwa-btn-install-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
          Install App
        </button>
        <button id="pwaBannerDismissBtn" class="pwa-btn-dismiss" title="Dismiss">&times;</button>
      </div>
    `;
    document.body.appendChild(banner);

    // 2. Create iOS Modal Guide
    const iosModal = document.createElement('div');
    iosModal.id = 'pwaIosModal';
    iosModal.className = 'pwa-ios-modal-backdrop';
    iosModal.innerHTML = `
      <div class="pwa-ios-modal">
        <div class="pwa-ios-handle"></div>
        <img src="${appIcon}" alt="Logo" style="width:54px; height:54px; border-radius:14px; margin-bottom:12px; box-shadow:0 4px 12px rgba(0,0,0,0.15);" />
        <h3 class="pwa-ios-title">Install ${appName}</h3>
        <p class="pwa-ios-subtitle">iPhone / iPad par App install karne ke aasan steps:</p>
        
        <div class="pwa-ios-steps">
          <div class="pwa-ios-step-item">
            <span class="pwa-ios-step-num">1</span>
            <span class="pwa-ios-step-text">Safari browser mein niche <strong>Share Button</strong> <span class="pwa-ios-icon-badge">⬆️ Share</span> par tap karein.</span>
          </div>
          <div class="pwa-ios-step-item">
            <span class="pwa-ios-step-num">2</span>
            <span class="pwa-ios-step-text">Niche scroll karke <strong>'Add to Home Screen'</strong> <span class="pwa-ios-icon-badge">➕ Add</span> chunein.</span>
          </div>
          <div class="pwa-ios-step-item">
            <span class="pwa-ios-step-num">3</span>
            <span class="pwa-ios-step-text">Upar daayein kone mein <strong>'Add'</strong> par click karein. App Home Screen par aa jayegi!</span>
          </div>
        </div>

        <button id="pwaIosCloseBtn" class="pwa-ios-close-btn">Samajh Gaya (Done)</button>
      </div>
    `;
    document.body.appendChild(iosModal);

    // Event bindings
    const bannerInstallBtn = document.getElementById('pwaBannerInstallBtn');
    const bannerDismissBtn = document.getElementById('pwaBannerDismissBtn');
    const iosCloseBtn = document.getElementById('pwaIosCloseBtn');

    if (bannerInstallBtn) {
      bannerInstallBtn.addEventListener('click', triggerInstallFlow);
    }
    if (bannerDismissBtn) {
      bannerDismissBtn.addEventListener('click', () => {
        banner.classList.remove('pwa-show');
        sessionStorage.setItem('pwa_banner_dismissed', 'true');
      });
    }
    if (iosCloseBtn) {
      iosCloseBtn.addEventListener('click', () => {
        iosModal.classList.remove('pwa-active');
      });
    }
    iosModal.addEventListener('click', (e) => {
      if (e.target === iosModal) {
        iosModal.classList.remove('pwa-active');
      }
    });

    // Wire up all custom buttons on page with class .pwa-install-trigger or id #btnInstallApp
    document.querySelectorAll('.pwa-install-trigger, #btnInstallApp, #btnInstallAppNav, #btnAdminInstall').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        triggerInstallFlow();
      });
    });

    // Auto-show banner after 1.5 seconds if not dismissed
    setTimeout(() => {
      if (!sessionStorage.getItem('pwa_banner_dismissed')) {
        banner.classList.add('pwa-show');
      }
    }, 1500);
  }

  // Trigger Install Logic
  window.triggerPwaInstall = triggerInstallFlow;
  function triggerInstallFlow() {
    if (deferredPrompt) {
      // Android / Chrome / Edge
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('[PWA] User accepted the install prompt');
          const banner = document.getElementById('pwaBottomBanner');
          if (banner) banner.classList.remove('pwa-show');
        } else {
          console.log('[PWA] User dismissed the install prompt');
        }
        deferredPrompt = null;
      });
    } else if (isIOS) {
      // iPhone / iPad Safari modal
      const iosModal = document.getElementById('pwaIosModal');
      if (iosModal) {
        iosModal.classList.add('pwa-active');
      }
    } else {
      // Fallback for browsers that already installed or where prompt isn't directly triggerable
      alert('To install this app on your device:\n\n1. Open your browser menu (⋮ or Share icon)\n2. Tap "Install app" or "Add to Home Screen"');
    }
  }

  // Listen for beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent default browser mini-infobar
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] captured beforeinstallprompt event');

    // Show banner if not already shown
    const banner = document.getElementById('pwaBottomBanner');
    if (banner) {
      banner.classList.add('pwa-show');
    }
  });

  // App Installed event
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Rudraksha App successfully installed!');
    const banner = document.getElementById('pwaBottomBanner');
    if (banner) {
      banner.classList.remove('pwa-show');
    }
    deferredPrompt = null;
  });

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPwaUI);
  } else {
    initPwaUI();
  }
})();
