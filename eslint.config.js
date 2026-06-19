const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['.build/**', 'supabase/functions/**', 'supabase/migrations/**', 'supabase/schema.sql'],
  },
  prettierConfig,
]);
