import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
// Gruvbox dark (hard contrast) syntax theme — see src/css/prism-gruvbox.js
import gruvboxTheme from './src/css/prism-gruvbox.js';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Clippy Chat',
  tagline: 'A worked example of a Palo Alto AI Red Teaming custom target adapter',
  favicon: 'img/logo-square.svg',

  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // GitHub Pages: https://cdot65.github.io/clippy-chat/
  url: 'https://cdot65.github.io',
  baseUrl: '/clippy-chat/',
  organizationName: 'cdot65',
  projectName: 'clippy-chat',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/', // docs are the site root
          editUrl: 'https://github.com/cdot65/clippy-chat/tree/main/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo-horizontal.svg',
    colorMode: {
      // Gruvbox brand is dark-only.
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Clippy Chat',
      logo: {
        alt: 'Clippy Chat',
        src: 'img/logo-square.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/red-team/overview',
          label: 'Red-Team Adapter',
          position: 'left',
        },
        {
          href: 'https://github.com/cdot65/clippy-chat',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Overview', to: '/'},
            {label: 'Getting Started', to: '/getting-started'},
            {label: 'Red-Team Adapter', to: '/red-team/overview'},
          ],
        },
        {
          title: 'Reference',
          items: [
            {label: 'HTTP API', to: '/reference/api'},
            {label: 'Configuration', to: '/reference/configuration'},
            {label: 'Database Schema', to: '/reference/database'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: 'https://github.com/cdot65/clippy-chat'},
          ],
        },
      ],
      copyright: `Clippy Chat — built as a Palo Alto AI Red Teaming adapter example.`,
    },
    prism: {
      theme: gruvboxTheme,
      darkTheme: gruvboxTheme,
      additionalLanguages: ['bash', 'json', 'diff', 'python', 'typescript', 'sql'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
