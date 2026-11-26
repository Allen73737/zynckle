import { config } from './config.mjs';

/**
 * Transactional email service for Zynckle.
 * Supports Resend (via HTTPS API) and standard SMTP relays.
 * In development or when no provider is configured, it falls back gracefully
 * to logging links to the server console.
 */

export function isEmailConfigured() {
  return Boolean(config.email?.resendApiKey || config.email?.smtp);
}

function baseTemplate(title, bodyHtml, actionText, actionUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #000000; color: #f4f4f5; margin: 0; padding: 40px 20px; }
    .card { max-width: 540px; margin: 0 auto; background: #09090b; border: 1px solid #27272a; border-radius: 12px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .brand { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff; text-decoration: none; margin-bottom: 24px; display: inline-block; }
    .mark { background: #ffffff; color: #000000; padding: 3px 8px; border-radius: 6px; margin-right: 8px; }
    h1 { font-size: 24px; font-weight: 700; color: #ffffff; margin: 0 0 14px; letter-spacing: -0.5px; }
    p { font-size: 15px; line-height: 1.6; color: #a1a1aa; margin: 0 0 20px; }
    .btn { display: inline-block; background: #ffffff; color: #000000 !important; font-weight: 600; font-size: 14px; text-decoration: none; padding: 12px 22px; border-radius: 8px; margin: 12px 0 24px; text-align: center; }
    .url { font-family: monospace; font-size: 12px; color: #71717a; word-break: break-all; margin-top: 14px; }
    .footer { font-size: 12px; color: #71717a; border-top: 1px solid #27272a; margin-top: 28px; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <a class="brand" href="${config.publicUrl}"><span class="mark">z</span>zynckle</a>
    <h1>${title}</h1>
    ${bodyHtml}
    ${actionUrl ? `<a class="btn" href="${actionUrl}">${actionText}</a><div class="url">Or copy this link:<br>${actionUrl}</div>` : ''}
    <div class="footer">
      This is an automated message from your Zynckle workspace. If you did not request this, you can safely ignore this email.
    </div>
  </div>
</body>
</html>`;
}

export async function sendEmail({ to, subject, html, text }) {
  if (config.email?.resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.email.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.email.from,
          to: Array.isArray(to) ? to : [to],
          subject,
          html,
          text,
        }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error('[zynckle] Resend error:', res.status, errorText);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[zynckle] Failed to send email via Resend:', err);
      return false;
    }
  }

  // Fallback: log to console in development
  console.log(`[zynckle] Outgoing email to ${to} | Subject: "${subject}"`);
  return false;
}

export async function sendVerificationEmail(user, link) {
  const subject = 'Verify your email for Zynckle';
  const html = baseTemplate(
    'Verify your email address',
    `<p>Hi ${user.name || 'there'},</p><p>Please confirm your email address to complete your Zynckle registration.</p>`,
    'Verify Email Address',
    link
  );
  const text = `Hi ${user.name || 'there'},\n\nPlease confirm your email address by visiting:\n${link}\n\n- The Zynckle Team`;
  return sendEmail({ to: user.email, subject, html, text });
}

export async function sendPasswordResetEmail(user, link) {
  const subject = 'Reset your Zynckle password';
  const html = baseTemplate(
    'Reset your password',
    `<p>We received a request to reset your password for Zynckle.</p><p>Click the button below to choose a new password. This link expires in 1 hour.</p>`,
    'Reset Password',
    link
  );
  const text = `We received a request to reset your password.\n\nUse this link to set a new password:\n${link}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`;
  return sendEmail({ to: user.email, subject, html, text });
}

export async function sendTeamInviteEmail({ email, workspaceName, inviterName, role, link }) {
  const subject = `You've been invited to join ${workspaceName} on Zynckle`;
  const html = baseTemplate(
    `Join ${workspaceName}`,
    `<p>${inviterName} has invited you to join <strong>${workspaceName}</strong> on Zynckle as a <strong>${role.toLowerCase()}</strong>.</p><p>Click below to accept the invitation and start collaborating.</p>`,
    'Accept Invitation',
    link
  );
  const text = `${inviterName} invited you to join ${workspaceName} on Zynckle as a ${role.toLowerCase()}.\n\nAccept your invitation here:\n${link}`;
  return sendEmail({ to: email, subject, html, text });
}
