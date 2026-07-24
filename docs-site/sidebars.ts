import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Explicit sidebar. The Red-Team Adapter is the primary purpose of this project,
 * so it sits high in the navigation.
 */
const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Red-Team Adapter',
      collapsed: false,
      link: {type: 'doc', id: 'red-team/overview'},
      items: [
        'red-team/adapter',
        'red-team/oauth2-debug',
        'red-team/mcp-adapter',
        'red-team/running-a-scan',
      ],
    },
    'architecture',
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/authentication',
        'guides/chat-pipeline',
        'guides/admin-panel',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'reference/api',
        'reference/configuration',
        'reference/database',
      ],
    },
    'deployment',
  ],
};

export default sidebars;
