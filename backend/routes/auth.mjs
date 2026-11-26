import { randomBytes } from 'node:crypto';
import { db, persist, sha256, defaultNotificationPrefs } from '../lib/store.mjs';
import { config } from '../lib/config.mjs';
import { fail, rateLimit, clientIp, str, isEmail } from '../lib/http.mjs';
import {
  now, id, createSession, verifyPassword, setPassword, validatePassword, issueToken, consumeToken,
  createWorkspace, publicUser, logActivity,
} from '../lib/core.mjs';
import { deleteWorkspaceData } from './workspaces.mjs';
import { removeObject } from '../lib/storage.mjs';
import { isEmailConfigured, sendVerificationEmail, sendPasswordResetEmail } from '../lib/email.mjs';

const devLink = (path, token) => (config.exposeDevLinks ? `${config.publicUrl}${path}${token}` : undefined);

function startVerification(user) {
  const token = issueToken('verify', user.id, 3 * 86_400_000);
  const link = `${config.publicUrl}/verify-email?token=${token}`;
  console.log(`[zynckle] Email verification link for ${user.email}: ${link}`);
  if (isEmailConfigured()) {
    sendVerificationEmail(user, link).catch(err => console.error('[zynckle] Email verification dispatch failed:', err));
  }
  return devLink('/verify-email?token=', token);
}

function meFor(ctx) {
  const { user, workspace, role } = ctx;
  return {
    id: user.id, name: user.name, email: user.email, title: user.title || '', bio: user.bio || '',
    emailVerified: Boolean(user.emailVerified), hasPassword: Boolean(user.password), googleLinked: Boolean(user.googleId),
    role, preferences: user.preferences || {}, notificationPrefs: { ...defaultNotificationPrefs, ...user.notificationPrefs },
    createdAt: user.createdAt, workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
  };
}

export default function register(router) {
  const authLimit = ctx => rateLimit(`auth:${clientIp(ctx.req)}`, Number(process.env.AUTH_RATE_PER_MINUTE || 12), 60_000);

  router.post('/api/auth/register', async ctx => {
    authLimit(ctx);
    const name = str(ctx.body.name, { min: 1, max: 100, field: 'Name' });
    const email = str(ctx.body.email, { max: 320, field: 'Email' }).toLowerCase();
    if (!isEmail(email)) fail(400, 'Enter a valid email address');
    validatePassword(ctx.body.password);
    if (db.users.some(u => u.email === email)) fail(409, 'An account with this email already exists');
    const user = { id: id(), email, name, createdAt: now(), emailVerified: false, preferences: { theme: 'system' }, notificationPrefs: { ...defaultNotificationPrefs } };
    setPassword(user, ctx.body.password);
    db.users.push(user);
    const workspace = createWorkspace(user, ctx.body.workspaceName ? str(ctx.body.workspaceName, { min: 1, max: 80, field: 'Workspace name' }) : `${name.split(/\s+/)[0]}'s studio`);
    const verifyUrl = startVerification(user);
    const token = createSession(user, ctx.req);
    return [201, { token, user: publicUser(user), workspace, verifyUrl, emailDelivery: isEmailConfigured() }];
  }, { auth: false });

  router.post('/api/auth/login', async ctx => {
    authLimit(ctx);
    const email = String(ctx.body.email || '').trim().toLowerCase();
    rateLimit(`login:${email}`, 8, 300_000);
    const user = db.users.find(u => u.email === email);
    if (!user || !verifyPassword(user, String(ctx.body.password || ''))) fail(401, 'Email or password is incorrect');
    const token = createSession(user, ctx.req);
    return { token, user: publicUser(user) };
  }, { auth: false });

  router.post('/api/auth/logout', async ctx => {
    const hash = sha256(ctx.token || '');
    db.sessions = db.sessions.filter(s => s.tokenHash !== hash);
    persist();
    return { ok: true };
  }, { auth: false });

  router.post('/api/auth/forgot', async ctx => {
    authLimit(ctx);
    const email = String(ctx.body.email || '').trim().toLowerCase();
    const user = db.users.find(u => u.email === email);
    let resetUrl;
    if (user) {
      const token = issueToken('reset', user.id, 3_600_000);
      const link = `${config.publicUrl}/reset-password?token=${token}`;
      console.log(`[zynckle] Password reset link for ${email}: ${link}`);
      if (isEmailConfigured()) {
        sendPasswordResetEmail(user, link).catch(err => console.error('[zynckle] Password reset dispatch failed:', err));
      }
      resetUrl = devLink('/reset-password?token=', token);
    }
    // Same response whether or not the account exists, to avoid account enumeration.
    return { sent: true, emailDelivery: isEmailConfigured(), resetUrl: user ? resetUrl : undefined, devMode: config.exposeDevLinks };
  }, { auth: false });

  router.post('/api/auth/reset', async ctx => {
    authLimit(ctx);
    const record = consumeToken('reset', ctx.body.token);
    if (!record) fail(400, 'This reset link is invalid or has expired. Request a new one.');
    const user = db.users.find(u => u.id === record.userId);
    if (!user) fail(400, 'This reset link is no longer valid');
    validatePassword(ctx.body.password);
    setPassword(user, ctx.body.password);
    user.emailVerified = true; // proving control of the inbox also verifies it
    db.sessions = db.sessions.filter(s => s.userId !== user.id);
    persist();
    return { token: createSession(user, ctx.req) };
  }, { auth: false });

  router.post('/api/auth/verify', async ctx => {
    const record = consumeToken('verify', ctx.body.token);
    if (!record) fail(400, 'This verification link is invalid or has expired');
    const user = db.users.find(u => u.id === record.userId);
    if (!user) fail(400, 'Account not found');
    user.emailVerified = true;
    persist();
    return { verified: true, email: user.email };
  }, { auth: false });

  router.get('/api/auth/providers', async () => ({ password: true, google: Boolean(config.google.clientId && config.google.clientSecret), emailDelivery: isEmailConfigured() }), { auth: false });

  // ---- Google OAuth (only active when credentials are configured) ----
  router.get('/api/auth/google/start', async ctx => {
    if (!config.google.clientId) fail(404, 'Google sign-in is not configured');
    const state = randomBytes(18).toString('hex');
    db.tokens.push({ kind: 'oauth-state', tokenHash: sha256(state), expires: Date.now() + 600_000 });
    persist();
    const params = new URLSearchParams({
      client_id: config.google.clientId, redirect_uri: `${config.publicUrl}/api/auth/google/callback`, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
    });
    return { redirect: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  }, { auth: false });

  router.get('/api/auth/google/callback', async ctx => {
    const back = message => ({ redirect: `${config.publicUrl}/signin?error=${encodeURIComponent(message)}` });
    if (!config.google.clientId) return back('Google sign-in is not configured');
    if (!consumeToken('oauth-state', ctx.query.get('state'))) return back('Sign-in expired. Please try again.');
    const code = ctx.query.get('code');
    if (!code) return back('Google sign-in was cancelled');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: `${config.publicUrl}/api/auth/google/callback`, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokens.access_token) return back('Google did not accept the sign-in');
    const profile = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json();
    if (!profile.email || !profile.email_verified) return back('Your Google email address is not verified');
    const email = profile.email.toLowerCase();
    let user = db.users.find(u => u.googleId === profile.sub) || db.users.find(u => u.email === email);
    if (!user) {
      user = { id: id(), email, name: String(profile.name || email.split('@')[0]).slice(0, 100), createdAt: now(), emailVerified: true, preferences: { theme: 'system' }, notificationPrefs: { ...defaultNotificationPrefs } };
      db.users.push(user);
      createWorkspace(user, `${user.name.split(/\s+/)[0]}'s studio`);
    }
    user.googleId = profile.sub;
    user.emailVerified = true;
    persist();
    const session = createSession(user, ctx.req);
    return { redirect: `${config.publicUrl}/signin#token=${session}` };
  }, { auth: false, redirect: true });

  // ---- Authenticated account endpoints ----
  router.get('/api/auth/me', async ctx => meFor(ctx));

  router.post('/api/auth/verify/resend', async ctx => {
    rateLimit(`verify:${ctx.user.id}`, 3, 600_000);
    if (ctx.user.emailVerified) return { verified: true };
    return { sent: true, emailDelivery: isEmailConfigured(), verifyUrl: startVerification(ctx.user) };
  });

  router.patch('/api/auth/profile', async ctx => {
    const { user } = ctx;
    user.name = str(ctx.body.name ?? user.name, { min: 1, max: 100, field: 'Name' });
    if (ctx.body.title !== undefined) user.title = str(ctx.body.title, { max: 80, field: 'Title' });
    if (ctx.body.bio !== undefined) user.bio = str(ctx.body.bio, { max: 400, field: 'Bio' });
    let verifyUrl;
    if (ctx.body.email !== undefined) {
      const email = str(ctx.body.email, { max: 320, field: 'Email' }).toLowerCase();
      if (!isEmail(email)) fail(400, 'Enter a valid email address');
      if (email !== user.email) {
        if (db.users.some(u => u.id !== user.id && u.email === email)) fail(409, 'That email address is already in use');
        user.email = email;
        user.emailVerified = false;
        verifyUrl = startVerification(user);
      }
    }
    persist();
    return { ...meFor(ctx), verifyUrl };
  });

  router.patch('/api/auth/password', async ctx => {
    const { user } = ctx;
    if (user.password && !verifyPassword(user, String(ctx.body.currentPassword || ''))) fail(401, 'Current password is incorrect');
    validatePassword(ctx.body.newPassword);
    setPassword(user, ctx.body.newPassword);
    db.sessions = db.sessions.filter(s => s.userId !== user.id || s.id === ctx.session.id);
    logActivity(ctx, 'changed their password', 'account', null, { audit: true, private: true, summary: 'Password changed' });
    return { changed: true };
  });

  router.patch('/api/auth/preferences', async ctx => {
    const prefs = ctx.user.preferences ||= {};
    if (ctx.body.theme !== undefined) { if (!['light', 'dark', 'system'].includes(ctx.body.theme)) fail(400, 'Unknown theme'); prefs.theme = ctx.body.theme; }
    if (ctx.body.aiProvider !== undefined) prefs.aiProvider = ['groq', 'gemini', 'openrouter', ''].includes(ctx.body.aiProvider) ? ctx.body.aiProvider : '';
    if (ctx.body.aiModel !== undefined) prefs.aiModel = typeof ctx.body.aiModel === 'string' && /^[\w.:/-]{0,100}$/.test(ctx.body.aiModel) ? ctx.body.aiModel : '';
    if (ctx.body.aiWorkspaceContext !== undefined) prefs.aiWorkspaceContext = Boolean(ctx.body.aiWorkspaceContext);
    if (ctx.body.reducedMotion !== undefined) prefs.reducedMotion = Boolean(ctx.body.reducedMotion);
    persist();
    return prefs;
  });

  router.patch('/api/auth/notification-prefs', async ctx => {
    const prefs = { ...defaultNotificationPrefs, ...ctx.user.notificationPrefs };
    for (const key of Object.keys(defaultNotificationPrefs)) if (typeof ctx.body[key] === 'boolean') prefs[key] = ctx.body[key];
    ctx.user.notificationPrefs = prefs;
    persist();
    return prefs;
  });

  router.get('/api/auth/sessions', async ctx => db.sessions.filter(s => s.userId === ctx.user.id && s.expires > Date.now())
    .map(s => ({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, userAgent: s.userAgent, ip: s.ip, current: s.id === ctx.session.id }))
    .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '')));

  router.delete('/api/auth/sessions/:sid', async ctx => {
    if (ctx.params.sid === ctx.session.id) fail(400, 'Use sign out to end the current session');
    db.sessions = db.sessions.filter(s => !(s.userId === ctx.user.id && s.id === ctx.params.sid));
    persist();
    return { revoked: true };
  });

  router.post('/api/auth/sessions/revoke-others', async ctx => {
    const before = db.sessions.length;
    db.sessions = db.sessions.filter(s => s.userId !== ctx.user.id || s.id === ctx.session.id);
    persist();
    return { revoked: before - db.sessions.length };
  });

  /**
   * Account deletion: blocked while the user owns a workspace with other members
   * (ownership must be transferred first). Owned solo workspaces are deleted with all
   * content; memberships elsewhere are removed; personal data is erased.
   */
  router.delete('/api/auth/account', async ctx => {
    const { user } = ctx;
    if (user.password && !verifyPassword(user, String(ctx.body.password || ''))) fail(401, 'Enter your current password to confirm');
    const owned = db.workspaces.filter(w => w.ownerId === user.id);
    const blocked = owned.filter(w => db.workspaceMembers.some(m => m.workspaceId === w.id && m.userId !== user.id));
    if (blocked.length) fail(409, `Transfer ownership of ${blocked.map(w => w.name).join(', ')} before deleting your account`, { workspaces: blocked.map(w => ({ id: w.id, name: w.name })) });
    for (const workspace of owned) await deleteWorkspaceData(workspace.id);
    for (const file of db.files.filter(f => f.ownerId === user.id && f.visibility === 'private')) { if (file.storageKey) await removeObject(file.storageKey, file.storage); }
    db.files = db.files.filter(f => !(f.ownerId === user.id && f.visibility === 'private'));
    db.documents = db.documents.filter(d => !(d.ownerId === user.id && d.visibility === 'private'));
    db.workspaceMembers = db.workspaceMembers.filter(m => m.userId !== user.id);
    db.notifications = db.notifications.filter(n => n.userId !== user.id);
    db.aiConversations = db.aiConversations.filter(c => c.userId !== user.id);
    db.architectures = db.architectures.filter(a => !(a.ownerId === user.id && a.visibility === 'private'));
    db.sessions = db.sessions.filter(s => s.userId !== user.id);
    db.tokens = db.tokens.filter(t => t.userId !== user.id);
    for (const task of db.tasks) if (task.assigneeId === user.id) task.assigneeId = null;
    for (const project of db.projects) project.memberIds = (project.memberIds || []).filter(x => x !== user.id);
    db.users = db.users.filter(u => u.id !== user.id);
    persist();
    return { deleted: true };
  });
}

export { meFor };
