/**
 * Rudraksha Packers & Movers - PWA Direct 1-Click Installer
 * Prioritizes 100% native 1-click install prompt on Android & Desktop
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
          // Check for service worker updates
          if (reg.update) reg.update();
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration:', err);
        });
    });
  }

  // Device & Context
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const isAdmin = window.location.pathname.includes('admin.html');
  const appName = isAdmin ? 'Rudraksha Admin Control' : 'Rudraksha Packers & Movers';
  const appDesc = isAdmin ? 'Live Fleets, Booking & Rates' : 'Fast Shifting & Parcel Delivery App';
  const appIcon = 'icon-192.png';

  let deferredPrompt = null;
  let isAppInstalled = isStandalone;

  // Listen for native install prompt event IMMEDIATELY
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Native 1-Click Install Prompt is READY!');

    // Show bottom banner
    const banner = document.getElementById('pwaBottomBanner');
    if (banner && !sessionStorage.getItem('pwa_banner_dismissed')) {
      banner.classList.add('pwa-show');
    }
  });

  // App Installed Event
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App successfully installed!');
    isAppInstalled = true;
    deferredPrompt = null;
    const banner = document.getElementById('pwaBottomBanner');
    if (banner) banner.classList.remove('pwa-show');
    const modal = document.getElementById('pwaUniversalModal');
    if (modal) modal.classList.remove('pwa-active');
  });

  // If already running inside standalone app, exit early
  if (isStandalone) {
    console.log('[PWA] Running inside standalone installed app');
    return;
  }

  // 2. Initialize UI
  function initPwaUI() {
    // A. Bottom Banner
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

    // B. Universal Modal (Only shown for iOS Safari or when native prompt is unsupported)
    const modalBackdrop = document.createElement('div');
    modalBackdrop.id = 'pwaUniversalModal';
    modalBackdrop.className = 'pwa-universal-modal-backdrop';
    modalBackdrop.innerHTML = `
      <div class="pwa-universal-modal">
        <div class="pwa-modal-header">
          <div class="pwa-modal-app-badge">
            <img src="${appIcon}" alt="App Icon" class="pwa-modal-icon" />
            <div style="text-align: left;">
              <h4 class="pwa-modal-title">${appName}</h4>
              <p class="pwa-modal-subtitle">Official Mobile App</p>
            </div>
          </div>
        </div>

        <div class="pwa-direct-install-box">
          <button type="button" id="pwaModalDirectInstallBtn" class="pwa-btn-direct-install">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
            </svg>
            <span id="pwaDirectBtnText">📲 Direct Install App Now</span>
          </button>
        </div>

        <!-- iOS Guide (Only relevant for Apple Safari) -->
        <div id="pwaIosGuideSection" style="${isIOS ? 'display:block;' : 'display:none;'}">
          <p style="font-size:0.86rem; color:#64748b; margin-bottom:12px;">iPhone / Safari me install karne ke liye:</p>
          <div class="pwa-step-card" style="margin-bottom:8px;">
            <span class="pwa-step-num">1</span>
            <span class="pwa-step-text">Safari ke niche <span class="pwa-badge-ios">⬆️ Share Button</span> par tap karein.</span>
          </div>
          <div class="pwa-step-card" style="margin-bottom:8px;">
            <span class="pwa-step-num">2</span>
            <span class="pwa-step-text">Menu me <span class="pwa-badge-ios">➕ Add to Home Screen</span> chunein.</span>
          </div>
          <div class="pwa-step-card" style="margin-bottom:14px;">
            <span class="pwa-step-num">3</span>
            <span class="pwa-step-text">Upar daayein kone me <strong>"Add"</strong> dabayein.</span>
          </div>
        </div>

        <div class="pwa-perks-box">
          <i class="fa-solid fa-bolt"></i>
          <span>Superfast &bull; Live GPS Tracking &bull; 0 MB Storage</span>
        </div>

        <button type="button" id="pwaModalCloseBtn" class="pwa-modal-close-btn">Close</button>
      </div>
    `;
    document.body.appendChild(modalBackdrop);

    // Event Bindings
    const bannerInstallBtn = document.getElementById('pwaBannerInstallBtn');
    const bannerDismissBtn = document.getElementById('pwaBannerDismissBtn');
    const modalCloseBtn = document.getElementById('pwaModalCloseBtn');
    const modalDirectInstallBtn = document.getElementById('pwaModalDirectInstallBtn');

    if (bannerInstallBtn) bannerInstallBtn.addEventListener('click', handleDirectInstall);
    if (bannerDismissBtn) {
      bannerDismissBtn.addEventListener('click', () => {
        banner.classList.remove('pwa-show');
        sessionStorage.setItem('pwa_banner_dismissed', 'true');
      });
    }
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', () => {
        modalBackdrop.classList.remove('pwa-active');
      });
    }
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        modalBackdrop.classList.remove('pwa-active');
      }
    });

    if (modalDirectInstallBtn) {
      modalDirectInstallBtn.addEventListener('click', handleDirectInstall);
    }

    // Bind all buttons with .pwa-install-trigger, #btnInstallApp, #btnInstallAppNav, .btn-mobile-nav-app
    document.querySelectorAll('.pwa-install-trigger, #btnInstallApp, #btnInstallAppNav, #btnAdminInstall, .btn-mobile-nav-app').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        handleDirectInstall();
      });
    });

    // Auto-show banner after 1.2s if prompt ready
    setTimeout(() => {
      if (!sessionStorage.getItem('pwa_banner_dismissed') && (deferredPrompt || !isStandalone)) {
        banner.classList.add('pwa-show');
      }
    }, 1200);

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

  // 3. Direct 1-Click Installation Logic
  window.triggerPwaInstall = handleDirectInstall;
  async function handleDirectInstall() {
    // If prompt is immediately ready: Fire native Android prompt!
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;
        console.log('[PWA] User install choice:', choiceResult.outcome);
        if (choiceResult.outcome === 'accepted') {
          const banner = document.getElementById('pwaBottomBanner');
          if (banner) banner.classList.remove('pwa-show');
          const modal = document.getElementById('pwaUniversalModal');
          if (modal) modal.classList.remove('pwa-active');
        }
        deferredPrompt = null;
        return;
      } catch (err) {
        console.warn('[PWA] Direct prompt error:', err);
      }
    }

    // If deferredPrompt is not yet ready, wait up to 1.5 seconds for it
    const promptArrived = await waitForDeferredPrompt(1500);
    if (promptArrived && deferredPrompt) {
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

    // If on iOS: Open simple iOS Share modal
    if (isIOS) {
      const modal = document.getElementById('pwaUniversalModal');
      if (modal) modal.classList.add('pwa-active');
      return;
    }

    // If on Android and native prompt didn't fire, it means:
    // Either already installed on device, or browser requires 3-dot menu
    // Open Chrome's menu guidance or show alert
    const modal = document.getElementById('pwaUniversalModal');
    if (modal) {
      const directBtnText = document.getElementById('pwaDirectBtnText');
      if (directBtnText) {
        directBtnText.innerText = '📲 Tap Chrome 3-Dots (⋮) ➔ Install App';
      }
      modal.classList.add('pwa-active');
    }
  }

  function waitForDeferredPrompt(timeoutMs) {
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

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPwaUI);
  } else {
    initPwaUI();
  }
})();
