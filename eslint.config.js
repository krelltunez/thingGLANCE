import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import i18next from 'eslint-plugin-i18next'
import tseslint from 'typescript-eslint'

// Flat config, the same rule set as lastGLANCE. Lints sources only; build
// output, future native shells and generated assets are ignored.
export default tseslint.config(
  {
    ignores: ['dist', 'dev-dist', 'dist-electron', 'dist-app', 'android', 'ios', 'public', 'coverage', 'e2e/out'],
  },
  {
    files: ['**/*.{ts,tsx,cts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Destructuring a row to drop fields (`const { sample, ...rest } = row`)
      // is how local-only fields are kept off the wire.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Words on screen come from the catalog (src/locales), never from a
    // component. This catches text between tags and in the props that carry
    // text; strings built in plain code (a toast, an option list) it cannot
    // see, so those are on the author.
    files: ['src/**/*.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': ['error', {
        mode: 'jsx-only',
        'jsx-attributes': { include: ['title', 'aria-label', 'placeholder', 'alt', 'label', 'hint', 'body', 'subtitle', 'holderLabel', 'description', 'empty'] },
        // Nothing to translate in a string with no letters ("·", "—", "/"),
        // or in the family's own names.
        words: { exclude: ['[^a-zA-Z]+', '(thing|day|last|life)GLANCE', 'GLANCEvault( Pro)?', 'GLANCElauncher'] },
        // Arguments to these are keys, formats and ids, not text.
        callees: { exclude: ['i18n(ext)?', 't', 'tr', 'require', 'addEventListener', 'removeEventListener', 'postMessage', 'getElementById', 'dispatch', 'commit', 'includes', 'indexOf', 'endsWith', 'startsWith', 'fmtDay', 'fmtMoment', 'cycleShort', 'cycleLabel', 'format', 'add', 'subtract', 'startOf', 'endOf', 'diff', 'cx'] },
      }],
    },
  },
  {
    // Node-context config, build and test-driver files are not browser code.
    files: ['*.{js,cjs,ts}', 'scripts/**/*.{js,cjs,mjs,ts}', 'e2e/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
)
