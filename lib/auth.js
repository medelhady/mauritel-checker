'use strict';
/*
 * تسجيل الدخول عبر Supabase Auth.
 * - بدون SUPABASE_URL (تشغيل محلي): لا يوجد تسجيل دخول.
 * - مع SUPABASE_URL: كل طلب يحتاج Authorization: Bearer <access_token> لمستخدم
 *   بريده ضمن ALLOWED_EMAILS (قائمة مفصولة بفواصل). إن لم تُضبط القائمة يُرفض الجميع.
 */

function authConfig(env) {
  return {
    authRequired: !!env.SUPABASE_URL,
    supabaseUrl: env.SUPABASE_URL || null,
    supabaseAnonKey: env.SUPABASE_ANON_KEY || null // المفتاح العام (anon) مصمَّم ليظهر في المتصفح
  };
}

async function authorize(headers, env, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  if (!env.SUPABASE_URL) return { ok: true, bearer: false };

  const m = /^Bearer\s+(.+)$/i.exec((headers && headers.authorization) || '');
  if (!m) return { ok: false, status: 401, error: 'يلزم تسجيل الدخول' };

  const allowed = String(env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return { ok: false, status: 503, error: 'ALLOWED_EMAILS غير مضبوط على الخادم' };

  let user;
  try {
    const r = await doFetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_ANON_KEY || '', Authorization: 'Bearer ' + m[1] },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return { ok: false, status: 401, error: 'جلسة غير صالحة، سجّل الدخول من جديد' };
    user = await r.json();
  } catch (e) {
    return { ok: false, status: 503, error: 'تعذّر التحقق من الجلسة' };
  }

  const email = String((user && user.email) || '').toLowerCase();
  const confirmed = !!(user && (user.email_confirmed_at || user.confirmed_at));
  if (!email || !confirmed || !allowed.includes(email)) {
    return { ok: false, status: 403, error: 'هذا الحساب غير مصرّح له' };
  }
  return { ok: true, bearer: true, email };
}

module.exports = { authorize, authConfig };
