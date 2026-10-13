'use strict';
/* يختار نوع التخزين: Supabase إن ضُبطت متغيراته، وإلا ملفات محلية في data/ */
const { createFileStore } = require('./store-file');
const { createSupabaseStore } = require('./store-supabase');

function supabaseConfigured(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_ANON_KEY);
}

function createStore(env, dataDir, fetchImpl) {
  return supabaseConfigured(env) ? createSupabaseStore(env, dataDir, fetchImpl) : createFileStore(dataDir);
}

module.exports = { createStore, supabaseConfigured };
