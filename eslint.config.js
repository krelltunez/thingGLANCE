import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
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
    // Node-context config, build and test-driver files are not browser code.
    files: ['*.{js,cjs,ts}', 'scripts/**/*.{js,cjs,mjs,ts}', 'e2e/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
)
