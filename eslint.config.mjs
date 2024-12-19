import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    'ignores': [
      '_resources/*',
      'static/*',
      'node_modules/*',
    ],
  },
  js.configs.recommended,
  {
    'files': [
      'src/**/*.mjs',
      '_index.mjs',
      'scripts/**/*.mjs',
      'eslint.config.mjs',
    ],
    'languageOptions': {
      'ecmaVersion': 2022,
      'sourceType': 'module',
      'globals': {
        ...globals.node,
      },
    },
    'rules': {
      'no-duplicate-imports': 2,
      'array-callback-return': 2,
      'block-scoped-var': 2,
      'consistent-return': 2,
      'default-case': 2,
      'object-shorthand': 2,
      'quote-props': 2,
      'quotes': [
        'error',
        'single',
      ],
      'object-curly-newline': 2,
      'no-multi-assign': 2,
      'no-else-return': 2,
      'indent': [
        'error',
        2,
      ],
      'keyword-spacing': 2,
      'space-infix-ops': 2,
      'eol-last': 2,
      'padded-blocks': 2,
      'no-multiple-empty-lines': 2,
      'space-in-parens': 2,
      'array-bracket-spacing': 2,
      'object-curly-spacing': 2,
      'block-spacing': 2,
      'key-spacing': 2,
      'no-trailing-spaces': 2,
      'comma-style': 2,
      'no-use-before-define': 2,
      'comma-dangle': [
        'error',
        {
          'arrays': 'always-multiline',
          'objects': 'always-multiline',
          'imports': 'always-multiline',
          'exports': 'always-multiline',
          'functions': 'always-multiline',
        },
      ],
      'semi': 2,
      'no-console': 0,
      'max-len': 0,
      'no-continue': 0,
      'no-bitwise': 0,
      'no-mixed-operators': 0,
      'no-underscore-dangle': 0,
      'import/prefer-default-export': 0,
      'class-methods-use-this': 0,
      'no-plusplus': 0,
      'global-require': 0,
    },
  },
];
