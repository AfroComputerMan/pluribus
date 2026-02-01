import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Allow setState in useEffect for state synchronization patterns
      'react-hooks/set-state-in-effect': 'warn',
      // Allow ref access during render for derived state patterns
      'react-hooks/refs': 'warn',
      // Allow impure functions like Date.now() for display calculations
      'react-hooks/purity': 'warn',
    },
  },
])
