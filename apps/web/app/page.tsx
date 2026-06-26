import IntakeFlow from './components/IntakeFlow';
import EducationCardComponent from './components/EducationCard';
import { EDUCATION_CARDS } from './lib/education';

const PHONE = '(800) 000-0000';

export default function HomePage() {
  return (
    <main>
      <nav className="nav">
        <div className="nav__inner">
          <a href="/" className="nav__logo" aria-label="Alara Home">
            <span className="nav__logo-word">Alara</span>
            <span className="nav__logo-sub">Home Care</span>
          </a>
          <a href={`tel:${PHONE.replace(/[^0-9]/g, '')}`} className="nav__phone">
            <span className="nav__phone-icon" aria-hidden="true">↗</span>
            {PHONE}
          </a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero__inner">
          <div className="hero__text">
            <p className="hero__eyebrow">Home health for complex situations</p>
            <h1 className="hero__headline display">
              You shouldn&apos;t have to<br />
              <em className="display-italic">navigate this alone.</em>
            </h1>
            <p className="hero__subhead">
              Tell us what&apos;s going on. Our team will take it from there.
            </p>
          </div>
          <div className="hero__intake">
            <IntakeFlow />
          </div>
          <div className="hero__or">
            <span>or call us directly</span>
          </div>
          <a href={`tel:${PHONE.replace(/[^0-9]/g, '')}`} className="hero__phone-cta">
            {PHONE}
          </a>
        </div>
      </section>

      <section className="trust">
        <div className="trust__inner">
          <div className="trust__item">
            <span className="trust__num">4 hrs</span>
            <p>Response to every referral</p>
          </div>
          <div className="trust__divider" aria-hidden="true" />
          <div className="trust__item">
            <span className="trust__num">EEOICPA</span>
            <p>White Card specialists</p>
          </div>
          <div className="trust__divider" aria-hidden="true" />
          <div className="trust__item">
            <span className="trust__num">VA</span>
            <p>Community Care network</p>
          </div>
          <div className="trust__divider" aria-hidden="true" />
          <div className="trust__item">
            <span className="trust__num">Medicare</span>
            <p>Certified home health</p>
          </div>
        </div>
      </section>

      <section className="how">
        <div className="how__inner">
          <h2 className="how__heading display">What happens when you reach out</h2>
          <p className="how__sub">You should always know what Alara is doing, why, and what comes next.</p>
          <div className="how__steps">
            <div className="how__step">
              <div className="how__step-num">1</div>
              <h3>You tell us what&apos;s going on</h3>
              <p>A few sentences is enough. You don&apos;t need a diagnosis, a referral number, or to know what program you qualify for. We&apos;ll figure that out together.</p>
            </div>
            <div className="how__step">
              <div className="how__step-num">2</div>
              <h3>We take ownership immediately</h3>
              <p>Within 4 hours, an Alara Care Guide calls you — not a call center, not an automated system. A real person who has already reviewed what you shared.</p>
            </div>
            <div className="how__step">
              <div className="how__step-num">3</div>
              <h3>We figure out your options together</h3>
              <p>Medicare, VA, EEOICPA, OWCP, private insurance — we know how these programs work and which ones may apply. We explain clearly and don&apos;t rush.</p>
            </div>
            <div className="how__step">
              <div className="how__step-num">4</div>
              <h3>Care begins, and we handle the rest</h3>
              <p>Authorization, scheduling, coordination with your physician, clinical care at home. You focus on your family. We handle the healthcare navigation.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="referral">
        <div className="referral__inner">
          <div className="referral__text">
            <p className="referral__eyebrow">For physicians &amp; referral sources</p>
            <h2 className="display">One call. We take it from there.</h2>
            <p>Alara contacts your patient within 4 hours of a referral, handles authorization and scheduling, and keeps you informed on clinical progress. We specialize in complex cases — EEOICPA, VA Community Care, multi-payer situations.</p>
            <a href={`tel:${PHONE.replace(/[^0-9]/g, '')}`} className="referral__cta">
              Make a referral — {PHONE}
            </a>
          </div>
          <div className="referral__callout">
            <p className="referral__callout-label">Alara accepts</p>
            <ul>
              <li>Medicare Part A Home Health</li>
              <li>EEOICPA / White Card</li>
              <li>VA Community Care</li>
              <li>OWCP / FECA</li>
              <li>Medicaid (select programs)</li>
              <li>Private &amp; commercial insurance</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="learn">
        <div className="learn__inner">
          <h2 className="learn__heading display">Learn at your own pace</h2>
          <p className="learn__sub">Healthcare is complicated. We explain it in plain language — as simply or as deeply as you need.</p>
          <div className="learn__cards">
            {EDUCATION_CARDS.map(card => (
              <EducationCardComponent key={card.id} card={card} />
            ))}
          </div>
        </div>
      </section>

      <section className="bottom-cta">
        <div className="bottom-cta__inner">
          <h2 className="display">Still not sure where to start?</h2>
          <p>That&apos;s the most common thing we hear. Call us, and we&apos;ll figure it out together. No pressure. No commitment. Just someone who knows how this works.</p>
          <a href={`tel:${PHONE.replace(/[^0-9]/g, '')}`} className="bottom-cta__phone">{PHONE}</a>
        </div>
      </section>

      <footer className="footer">
        <div className="footer__inner">
          <p className="footer__name">Alara Home Care</p>
          <p className="footer__legal">© {new Date().getFullYear()} Alara Home Care. Medicare-certified. Equal opportunity provider.</p>
        </div>
      </footer>

      <style>{`
        .nav { position: sticky; top: 0; z-index: 100; background: var(--bg); border-bottom: 1px solid var(--border); }
        .nav__inner { max-width: 1080px; margin: 0 auto; padding: 0 24px; height: 60px; display: flex; align-items: center; justify-content: space-between; }
        .nav__logo { text-decoration: none; display: flex; align-items: baseline; gap: 6px; }
        .nav__logo-word { font-family: var(--font-display); font-size: 20px; font-weight: 400; color: var(--text); }
        .nav__logo-sub { font-size: 12px; color: var(--text-soft); letter-spacing: 0.05em; }
        .nav__phone { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; color: var(--sage); text-decoration: none; padding: 8px 16px; border: 1px solid var(--sage); border-radius: 100px; transition: background 0.15s; }
        .nav__phone:hover { background: var(--sage-bg); }
        .nav__phone-icon { font-size: 12px; }

        .hero { min-height: 85vh; display: flex; align-items: center; padding: 80px 24px 64px; }
        .hero__inner { max-width: 680px; margin: 0 auto; width: 100%; text-align: center; }
        .hero__eyebrow { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sage); font-weight: 500; margin-bottom: 20px; }
        .hero__headline { font-size: clamp(36px, 6vw, 58px); color: var(--text); margin-bottom: 20px; }
        .hero__subhead { font-size: 18px; color: var(--text-mid); margin-bottom: 40px; line-height: 1.5; }
        .hero__intake { margin-bottom: 28px; }
        .hero__or { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; color: var(--text-soft); font-size: 13px; }
        .hero__or::before, .hero__or::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .hero__phone-cta { display: inline-block; font-size: 20px; font-family: var(--font-display); font-weight: 400; color: var(--sage); text-decoration: none; border-bottom: 1px solid var(--sage-light); padding-bottom: 2px; transition: color 0.15s; }
        .hero__phone-cta:hover { color: var(--text); }

        .trust { background: var(--text); padding: 32px 24px; }
        .trust__inner { max-width: 900px; margin: 0 auto; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; }
        .trust__item { text-align: center; padding: 8px 32px; color: white; }
        .trust__num { display: block; font-family: var(--font-display); font-size: 20px; font-weight: 300; margin-bottom: 2px; }
        .trust__item p { font-size: 12px; color: rgba(255,255,255,0.55); letter-spacing: 0.03em; }
        .trust__divider { width: 1px; height: 36px; background: rgba(255,255,255,0.15); }

        .how { padding: 80px 24px; background: var(--bg-warm); }
        .how__inner { max-width: 900px; margin: 0 auto; }
        .how__heading { font-size: clamp(26px, 4vw, 38px); color: var(--text); margin-bottom: 12px; }
        .how__sub { font-size: 16px; color: var(--text-mid); margin-bottom: 48px; }
        .how__steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 32px; }
        .how__step { position: relative; padding-top: 20px; }
        .how__step-num { width: 36px; height: 36px; border-radius: 50%; border: 1.5px solid var(--sage); color: var(--sage); font-family: var(--font-display); font-size: 16px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
        .how__step h3 { font-size: 16px; font-weight: 500; color: var(--text); margin-bottom: 8px; line-height: 1.3; }
        .how__step p { font-size: 14px; color: var(--text-mid); line-height: 1.6; }

        .referral { padding: 80px 24px; background: var(--sage); color: white; }
        .referral__inner { max-width: 900px; margin: 0 auto; display: grid; grid-template-columns: 1fr auto; gap: 48px; align-items: start; }
        .referral__eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.65); margin-bottom: 12px; }
        .referral__text h2 { font-size: clamp(24px, 3.5vw, 34px); color: white; margin-bottom: 16px; }
        .referral__text p { font-size: 15px; color: rgba(255,255,255,0.8); line-height: 1.65; margin-bottom: 24px; }
        .referral__cta { display: inline-block; background: white; color: var(--sage); font-size: 15px; font-weight: 500; text-decoration: none; padding: 12px 24px; border-radius: 8px; transition: opacity 0.15s; }
        .referral__cta:hover { opacity: 0.9; }
        .referral__callout { background: rgba(255,255,255,0.12); border-radius: 12px; padding: 24px; min-width: 220px; }
        .referral__callout-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.6); margin-bottom: 12px; }
        .referral__callout ul { list-style: none; display: flex; flex-direction: column; gap: 8px; }
        .referral__callout li { font-size: 14px; color: rgba(255,255,255,0.9); padding-left: 14px; position: relative; }
        .referral__callout li::before { content: '·'; position: absolute; left: 0; color: rgba(255,255,255,0.5); }

        .learn { padding: 80px 24px; background: var(--bg); }
        .learn__inner { max-width: 900px; margin: 0 auto; }
        .learn__heading { font-size: clamp(26px, 4vw, 38px); color: var(--text); margin-bottom: 12px; }
        .learn__sub { font-size: 16px; color: var(--text-mid); margin-bottom: 40px; }
        .learn__cards { display: flex; flex-direction: column; gap: 12px; }

        .bottom-cta { padding: 80px 24px; background: var(--bg-warm); text-align: center; }
        .bottom-cta__inner { max-width: 560px; margin: 0 auto; }
        .bottom-cta__inner h2 { font-size: clamp(26px, 4vw, 40px); color: var(--text); margin-bottom: 16px; }
        .bottom-cta__inner p { font-size: 16px; color: var(--text-mid); line-height: 1.65; margin-bottom: 32px; }
        .bottom-cta__phone { display: inline-block; font-size: 28px; font-family: var(--font-display); font-weight: 300; color: var(--sage); text-decoration: none; border-bottom: 1px solid var(--sage-light); padding-bottom: 2px; }
        .bottom-cta__phone:hover { color: var(--text); }

        .footer { background: var(--text); padding: 32px 24px; }
        .footer__inner { max-width: 900px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
        .footer__name { font-family: var(--font-display); font-size: 16px; font-weight: 300; color: rgba(255,255,255,0.7); }
        .footer__legal { font-size: 12px; color: rgba(255,255,255,0.35); }

        @media (max-width: 600px) {
          .trust__inner { flex-direction: column; gap: 16px; }
          .trust__divider { display: none; }
          .referral__inner { grid-template-columns: 1fr; }
          .referral__callout { min-width: unset; }
          .nav__phone { display: none; }
          .footer__inner { flex-direction: column; }
        }
      `}</style>
    </main>
  );
}
