/* ============================================
   מסעות תקומה בעוטף - Light interactivity
   ============================================ */

(function () {
  'use strict';

  /* ---------- Header: shrink on scroll ---------- */
  const header = document.getElementById('siteHeader');
  const onScroll = () => {
    if (window.scrollY > 20) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile nav toggle ---------- */
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');
  navToggle.addEventListener('click', () => {
    const expanded = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!expanded));
    mainNav.classList.toggle('is-open');
  });
  // Close mobile menu when a link is clicked
  mainNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navToggle.setAttribute('aria-expanded', 'false');
      mainNav.classList.remove('is-open');
    });
  });

  /* ---------- Scroll-reveal ---------- */
  const revealTargets = document.querySelectorAll(
    '.section-title, .section-lead, .story-body, .pillar-card, ' +
    '.builder-step, .voice-card, .map-point, .guide-feature, ' +
    '.guides-header-image, .leading-quote, .contact-form, .contact-intro'
  );
  revealTargets.forEach(el => el.classList.add('reveal'));

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    revealTargets.forEach(el => io.observe(el));
  } else {
    revealTargets.forEach(el => el.classList.add('is-visible'));
  }

  /* ---------- Contact form: client-side validation + mock submit ---------- */
  const form = document.getElementById('contactForm');
  const status = document.getElementById('formStatus');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    status.className = 'form-status';
    status.textContent = '';

    const data = Object.fromEntries(new FormData(form).entries());

    // Validate required fields
    const missing = ['name', 'org', 'phone', 'email'].filter(k => !data[k] || !String(data[k]).trim());
    if (missing.length) {
      status.classList.add('error');
      status.textContent = 'יש למלא את כל שדות החובה.';
      return;
    }
    // Basic email check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      status.classList.add('error');
      status.textContent = 'כתובת אימייל אינה תקינה.';
      return;
    }
    if (!data.consent) {
      status.classList.add('error');
      status.textContent = 'יש לאשר את מדיניות הפרטיות.';
      return;
    }

    // Mock submit - in production, connect to Formspree / WP form endpoint
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'שולח...';

    setTimeout(() => {
      status.classList.add('success');
      status.textContent = '✓ קיבלנו את הפרטים שלך. נחזור אליך בהקדם.';
      form.reset();
      submitBtn.disabled = false;
      submitBtn.textContent = 'שלחו - נחזור אליכם תוך 24 שעות';
    }, 900);
  });

  /* ---------- Smooth anchor scroll with header offset ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href === '#' || href.length < 2) return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const offset = header.offsetHeight + 12;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

})();
