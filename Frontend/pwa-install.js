/**
 * Rudraksha Packers & Movers - PWA Universal Install Handler & Smart Hub
 * Supports Android, Chrome, Edge, Samsung Internet, iOS (iPhone/iPad), and PC
 */

(function () {
  'use strict';

  // 1. Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker active:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration:', err);
        });
    });
  }

  // Device & Mode Detection
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isAndroid = /Android/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // Context: Admin vs Customer
  const isAdmin = window.location.pathname.includes('admin.html');
  const appName = isAdmin ? 'Rudraksha Admin Control' : 'Rudraksha Packers & Movers';
  const appDesc = isAdmin ? 'Live Fleet, Booking & Rate Engine' : 'Fast Relocation & Instant Parcel Delivery';
  const appIcon = 'icon-192.png';

  let deferredPrompt = null;

  // If already opened as standalone installed app, don't show prompts
  if (isStandalone) {
    console.log('[PWA] Running in standalone installed mode');
    return;
  }

  // 2. Initialize PWA UI Elements
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
            <span class="pwa-badge-verified">OFFICIAL APP</span>
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
        <button id="pwaBannerDismissBtn" class="pwa-btn-dismiss" title="Close Banner">&times;</button>
      </div>
    `;
    document.body.appendChild(banner);

    // B. Universal Multi-Device Install Modal
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
              <p class="pwa-modal-subtitle">Official Mobile Application</p>
            </div>
          </div>
        </div>

        <!-- Direct Install Button (If browser supports native trigger) -->
        <div class="pwa-direct-install-box" id="pwaDirectInstallWrapper">
          <button type="button" id="pwaModalDirectInstallBtn" class="pwa-btn-direct-install">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
            </svg>
            <span id="pwaDirectBtnText">1-Click Direct Install</span>
          </button>
        </div>

        <!-- Tabs for Switching Devices -->
        <div class="pwa-device-tabs">
          <button type="button" class="pwa-device-tab ${isAndroid || (!isIOS && !isAndroid) ? 'active' : ''}" data-target="pwaGuideAndroid">
            <i class="fa-brands fa-android"></i> Android (Chrome)
          </button>
          <button type="button" class="pwa-device-tab ${isIOS ? 'active' : ''}" data-target="pwaGuideIOS">
            <i class="fa-brands fa-apple"></i> iPhone (Safari)
          </button>
        </div>

        <!-- Android Guide -->
        <div class="pwa-guide-pane ${isAndroid || (!isIOS && !isAndroid) ? 'active' : ''}" id="pwaGuideAndroid">
          <div class="pwa-step-card">
            <span class="pwa-step-num">1</span>
            <span class="pwa-step-text">Chrome browser mein upar daayein taraf <strong>3 dots (⋮)</strong> menu par tap karein.</span>
          </div>
          <div class="pwa-step-card">
            <span class="pwa-step-num">2</span>
            <span class="pwa-step-text">Menu list mein <span class="pwa-badge-action">📲 Install app</span> ya <strong>"Add to Home screen"</strong> chunein.</span>
          </div>
          <div class="pwa-step-card">
            <span class="pwa-step-num">3</span>
            <span class="pwa-step-text"><strong>"Install"</strong> par tap karein. App turant aapke phone par aa jayegi!</span>
          </div>
        </div>

        <!-- iOS Guide -->
        <div class="pwa-guide-pane ${isIOS ? 'active' : ''}" id="pwaGuideIOS">
          <div class="pwa-step-card">
            <span class="pwa-step-num">1</span>
            <span class="pwa-step-text">Safari browser mein screen ke niche <span class="pwa-badge-ios">⬆️ Share Button</span> par tap karein.</span>
          </div>
          <div class="pwa-step-card">
            <span class="pwa-step-num">2</span>
            <span class="pwa-step-text">Niche scroll karke <span class="pwa-badge-ios">➕ Add to Home Screen</span> par click karein.</span>
          </div>
          <div class="pwa-step-card">
            <span class="pwa-step-num">3</span>
            <span class="pwa-step-text">Upar daayein kone mein <strong>"Add"</strong> dabayein. App icon iPhone screen par ban jayega!</span>
          </div>
        </div>

        <div class="pwa-perks-box">
          <i class="fa-solid fa-bolt"></i>
          <span>Superfast Booking &bull; Live GPS Tracking &bull; 0 MB Storage</span>
        </div>

        <button type="button" id="pwaModalCloseBtn" class="pwa-modal-close-btn">Done / Close</button>
      </div>
    `;
    document.body.appendChild(modalBackdrop);

    // Bind Tab Switching
    document.querySelectorAll('.pwa-device-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.pwa-device-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.pwa-guide-pane').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const targetId = tab.getAttribute('data-target');
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // Bind Close Buttons
    const modalCloseBtn = document.getElementById('pwaModalCloseBtn');
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

    // Direct Install Button inside Modal
    const modalDirectInstallBtn = document.getElementById('pwaModalDirectInstallBtn');
    if (modalDirectInstallBtn) {
      modalDirectInstallBtn.addEventListener('click', () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
              modalBackdrop.classList.remove('pwa-active');
              const b = document.getElementById('pwaBottomBanner');
              if (b) b.classList.remove('pwa-show');
            }
            deferredPrompt = null;
          });
        } else {
          // If on Android without native prompt, animate step 1 & 2
          const targetTab = isIOS ? 'pwaGuideIOS' : 'pwaGuideAndroid';
          const pane = document.getElementById(targetTab);
          if (pane) {
            pane.classList.add('active');
            pane.scrollIntoView({ behavior: 'smooth' });
          }
          const directBtnText = document.getElementById('pwaDirectBtnText');
          if (directBtnText) {
            directBtnText.innerText = isIOS ? 'Follow 3-Step Guide Below' : 'Follow Steps 1-3 Below (Browser Menu)';
          }
        }
      });
    }

    // Banner buttons
    const bannerInstallBtn = document.getElementById('pwaBannerInstallBtn');
    const bannerDismissBtn = document.getElementById('pwaBannerDismissBtn');
    if (bannerInstallBtn) {
      bannerInstallBtn.addEventListener('click', triggerInstallFlow);
    }
    if (bannerDismissBtn) {
      bannerDismissBtn.addEventListener('click', () => {
        banner.classList.remove('pwa-show');
        sessionStorage.setItem('pwa_banner_dismissed', 'true');
      });
    }

    // Auto-show bottom banner after 1.5s
    setTimeout(() => {
      if (!sessionStorage.getItem('pwa_banner_dismissed')) {
        banner.classList.add('pwa-show');
      }
    }, 1500);

    // Bind all install trigger buttons on the page
    document.querySelectorAll('.pwa-install-trigger, #btnInstallApp, #btnInstallAppNav, #btnAdminInstall, .btn-mobile-nav-app').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerInstallFlow();
      });
    });

    // Auto-close mobile navbar when link is clicked
    document.querySelectorAll('.main-navbar .nav-link-custom, .main-navbar a').forEach((link) => {
      link.addEventListener('click', () => {
        const navCollapse = document.getElementById('navbarContent');
        const hamburgerBtn = document.getElementById('mainHamburgerBtn');
        if (navCollapse && navCollapse.classList.contains('show')) {
          if (window.bootstrap && window.bootstrap.Collapse) {
            const bsCollapse = window.bootstrap.Collapse.getInstance(navCollapse) || new window.bootstrap.Collapse(navCollapse);
            if (bsCollapse) bsCollapse.hide();
          } else {
            navCollapse.classList.remove('show');
          }
          if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  // 3. Trigger Installation Flow
  window.triggerPwaInstall = triggerInstallFlow;
  function triggerInstallFlow() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        console.log('[PWA] User response:', choiceResult.outcome);
        if (choiceResult.outcome === 'accepted') {
          const b = document.getElementById('pwaBottomBanner');
          if (b) b.classList.remove('pwa-show');
          const m = document.getElementById('pwaUniversalModal');
          if (m) m.classList.remove('pwa-active');
        }
        deferredPrompt = null;
      });
    } else {
      // Open the Universal Install Guide Modal
      const modal = document.getElementById('pwaUniversalModal');
      if (modal) {
        modal.classList.add('pwa-active');
      }
    }
  }

  // 4. Capture native beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Native beforeinstallprompt captured!');
    const banner = document.getElementById('pwaBottomBanner');
    if (banner) banner.classList.add('pwa-show');

    const directBtnText = document.getElementById('pwaDirectBtnText');
    if (directBtnText) {
      directBtnText.innerText = '1-Click Direct Install (Ready)';
    }
  });

  // 5. App successfully installed
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Rudraksha App successfully installed on device!');
    const banner = document.getElementById('pwaBottomBanner');
    if (banner) banner.classList.remove('pwa-show');
    const modal = document.getElementById('pwaUniversalModal');
    if (modal) modal.classList.remove('pwa-active');
    deferredPrompt = null;
  });

  // Initialize on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPwaUI);
  } else {
    initPwaUI();
  }
})();
