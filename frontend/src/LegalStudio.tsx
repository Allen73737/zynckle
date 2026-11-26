import { Shield, Lock, FileText, CheckCircle2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export function PrivacyStudio() {
  return (
    <div className="subpage-root">
      <section className="welcome-row subpage-welcome">
        <div>
          <div className="eyebrow">LEGAL & DATA PRIVACY</div>
          <h1>Privacy <em>Policy.</em></h1>
          <p className="welcome-sub">
            Your data belongs to you. Zynckle is built with privacy-first principles: zero cross-tenant tracking,
            strictly salted and hashed credentials, and server-side secret management.
          </p>
        </div>
        <div className="zy-head-actions">
          <NavLink to="/terms" className="button-secondary">
            <FileText size={15} /> Terms of Service
          </NavLink>
        </div>
      </section>

      <div className="about-grid" style={{ maxWidth: '860px', margin: '0 auto' }}>
        <article className="topic-card active" style={{ gridColumn: '1 / -1' }}>
          <header className="topic-card-header">
            <span className="topic-card-icon"><Shield size={20} /></span>
            <div className="topic-card-title-group">
              <span className="topic-badge">Data Ownership</span>
              <h3>1. Absolute Workspace Ownership</h3>
            </div>
          </header>
          <p className="topic-summary">
            All documents, LaTeX sources, uploaded drive assets, code repositories, and task metadata created inside
            your workspace remain exclusively your intellectual property. Zynckle does not sell, license, or monetize your workspace data.
          </p>
          <div className="topic-specs">
            <div className="spec-item"><span className="spec-label">Customer Data</span><span className="spec-value">100% Owned by You</span></div>
            <div className="spec-item"><span className="spec-label">Model Training</span><span className="spec-value">Never Trained on Workspace Data</span></div>
          </div>
        </article>

        <article className="topic-card active" style={{ gridColumn: '1 / -1' }}>
          <header className="topic-card-header">
            <span className="topic-card-icon"><Lock size={20} /></span>
            <div className="topic-card-title-group">
              <span className="topic-badge">Security Standards</span>
              <h3>2. Cryptographic Security & Passwords</h3>
            </div>
          </header>
          <p className="topic-summary">
            Passwords are salted and cryptographically hashed with bcrypt/scrypt. Sessions are authenticated via HttpOnly,
            SameSite cookies and signed tokens. Sensitive provider credentials (Groq, Gemini, OpenRouter, AWS S3) reside
            exclusively on the server backend and are never exposed to the client browser.
          </p>
        </article>

        <article className="topic-card active" style={{ gridColumn: '1 / -1' }}>
          <header className="topic-card-header">
            <span className="topic-card-icon"><CheckCircle2 size={20} /></span>
            <div className="topic-card-title-group">
              <span className="topic-badge">Data Portability</span>
              <h3>3. Export & Right to Deletion</h3>
            </div>
          </header>
          <p className="topic-summary">
            You retain the unconditional right to export your workspace data or delete your account at any time. When an
            account or workspace is deleted by its owner, all associated documents, comments, file uploads, and session tokens
            are permanently purged.
          </p>
        </article>
      </div>
    </div>
  );
}

export function TermsStudio() {
  return (
    <div className="subpage-root">
      <section className="welcome-row subpage-welcome">
        <div>
          <div className="eyebrow">TERMS & CONDITIONS</div>
          <h1>Terms of <em>Service.</em></h1>
          <p className="welcome-sub">
            The rules and commitments governing the use of Zynckle for individual creators and enterprise teams.
          </p>
        </div>
        <div className="zy-head-actions">
          <NavLink to="/privacy" className="button-secondary">
            <Shield size={15} /> Privacy Policy
          </NavLink>
        </div>
      </section>

      <div className="about-grid" style={{ maxWidth: '860px', margin: '0 auto' }}>
        <article className="topic-card active" style={{ gridColumn: '1 / -1' }}>
          <header className="topic-card-header">
            <span className="topic-card-icon"><FileText size={20} /></span>
            <div className="topic-card-title-group">
              <span className="topic-badge">Agreement</span>
              <h3>1. Acceptance of Terms</h3>
            </div>
          </header>
          <p className="topic-summary">
            By creating an account or accessing Zynckle, you agree to comply with these terms. You are responsible for safeguarding
            your account credentials and ensuring all users invited to your workspace adhere to lawful, collaborative use.
          </p>
        </article>

        <article className="topic-card active" style={{ gridColumn: '1 / -1' }}>
          <header className="topic-card-header">
            <span className="topic-card-icon"><Shield size={20} /></span>
            <div className="topic-card-title-group">
              <span className="topic-badge">Acceptable Use</span>
              <h3>2. Permitted Conduct</h3>
            </div>
          </header>
          <p className="topic-summary">
            You may not use Zynckle to store or transmit malware, exploit reverse-engineered API endpoints, launch denial-of-service
            attacks, or violate intellectual property rights. Shared document links and preview sandboxes must not be used to distribute
            phishing or deceptive materials.
          </p>
        </article>

        <article className="topic-card active" style={{ gridColumn: '1 / -1' }}>
          <header className="topic-card-header">
            <span className="topic-card-icon"><Lock size={20} /></span>
            <div className="topic-card-title-group">
              <span className="topic-badge">Service Level</span>
              <h3>3. Availability & Warranties</h3>
            </div>
          </header>
          <p className="topic-summary">
            Zynckle provides a high-assurance platform with automated testing and continuous integration. The service is provided
            on an &ldquo;as is&rdquo; basis with continuous updates. Self-hosted instances are governed by the underlying open-source license.
          </p>
        </article>
      </div>
    </div>
  );
}
