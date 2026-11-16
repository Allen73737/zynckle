import { db, persist } from '../lib/store.mjs';
import { config } from '../lib/config.mjs';
import { fail } from '../lib/http.mjs';
import { userById } from '../lib/core.mjs';
import { aiStatus } from '../lib/ai.mjs';
import { storageDriver } from '../lib/storage.mjs';

export default function register(router) {
  router.get('/api/notifications', async ctx => {
    const unreadOnly = ctx.query.get('unread') === '1';
    const limit = Math.min(200, Number(ctx.query.get('limit')) || 100);
    return db.notifications.filter(n => n.userId === ctx.user.id && (!unreadOnly || !n.read)).slice(0, limit).map(n => ({
      ...n, workspace: db.workspaces.find(w => w.id === n.workspaceId)?.name || '', actor: n.actorId ? userById(n.actorId)?.name || 'Former member' : null,
    }));
  });

  router.post('/api/notifications/:id/read', async ctx => {
    const notification = db.notifications.find(n => n.id === ctx.params.id && n.userId === ctx.user.id);
    if (!notification) fail(404, 'Notification not found');
    notification.read = ctx.body.read === false ? false : true;
    persist();
    return { read: notification.read };
  });

  router.post('/api/notifications/read-all', async ctx => {
    for (const notification of db.notifications) if (notification.userId === ctx.user.id) notification.read = true;
    persist();
    return { updated: true };
  });

  router.delete('/api/notifications/:id', async ctx => {
    db.notifications = db.notifications.filter(n => !(n.id === ctx.params.id && n.userId === ctx.user.id));
    persist();
    return { deleted: true };
  });

  router.delete('/api/notifications', async ctx => {
    db.notifications = db.notifications.filter(n => !(n.userId === ctx.user.id && n.read));
    persist();
    return { cleared: true };
  });

  /** Honest status of every external integration this deployment knows about. */
  router.get('/api/integrations', async () => {
    const ai = aiStatus();
    return [
      { id: 'ai', name: 'AI providers', status: ai.available ? 'connected' : 'not-configured', detail: ai.available ? `${ai.provider} is the default provider` : 'Set GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY', env: ['AI_PROVIDER', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'] },
      { id: 'storage', name: 'Object storage', status: storageDriver === 's3' ? 'connected' : 'local', detail: storageDriver === 's3' ? `Cloudflare R2 / S3 bucket “${config.storage.bucket}”` : 'Files are stored on the API host disk', env: ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] },
      { id: 'github', name: 'GitHub', status: 'available', detail: 'Import public repositories into Zynckle Code. Private repositories and sync need a GitHub App (not configured).', env: [] },
      { id: 'google', name: 'Google sign-in', status: config.google.clientId && config.google.clientSecret ? 'connected' : 'not-configured', detail: config.google.clientId ? 'Users can sign in with Google' : 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET', env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
      { id: 'latex', name: 'LaTeX compiler', status: 'detect', detail: `Uses ${config.latexBin}`, env: ['LATEX_COMPILER'] },
      { id: 'email', name: 'Email delivery', status: 'not-configured', detail: 'Invites, password resets and verification links are logged by the API (and shown in development) instead of emailed.', env: [] },
    ];
  });
}
