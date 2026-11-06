import { t } from '../core/i18n';
import type { BrandName } from '../shared/brand-icon';

export interface McpSnippet {
  title: string;
  code: string;
}

export interface McpClientGuide {
  id: string;
  name: string;
  icon: string;
  /** A monochrome client logo; the Lucide icon is the fallback. */
  brand?: BrandName;
  steps: string[];
  snippet: McpSnippet;
  note?: string;
  key: { intro: string; snippet: McpSnippet | null };
  installLink?: { label: string; href: string };
}

export const MCP_KEY_PLACEHOLDER = 'schuly_mcp_YOUR_KEY';

export function mcpUrl(origin: string): string {
  return `${origin}/mcp`;
}

export function cursorInstallLink(url: string): string {
  const config = btoa(JSON.stringify({ url }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=schuly&config=${encodeURIComponent(config)}`;
}

export function vscodeInstallLink(url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'schuly', type: 'http', url }))}`;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export function mcpClientGuides(url: string): McpClientGuide[] {
  const bearerEnv = 'Bearer ${env:SCHULY_MCP_KEY}';
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      icon: 'lucideTerminal',
      brand: 'claude',
      steps: [
        t('mcp.guide.runTerminal'),
        t('mcp.guide.claudeCode2'),
        t('mcp.guide.claudeCode3'),
      ],
      snippet: { title: t('mcp.guide.terminal'), code: `claude mcp add --transport http schuly ${url}` },
      key: {
        intro: t('mcp.guide.keyHeader'),
        snippet: {
          title: t('mcp.guide.terminal'),
          code: `claude mcp add --transport http schuly ${url} --header "Authorization: Bearer ${MCP_KEY_PLACEHOLDER}"`,
        },
      },
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      icon: 'lucideMonitor',
      brand: 'claude',
      steps: [
        t('mcp.guide.desktop1'),
        t('mcp.guide.desktop2'),
        t('mcp.guide.desktop3', { url }),
        t('mcp.guide.desktop4'),
      ],
      snippet: { title: t('mcp.guide.connectorUrl'), code: url },
      note: t('mcp.guide.desktopNote'),
      key: {
        intro:
          t('mcp.guide.headersHint'),
        snippet: { title: t('mcp.guide.requestHeader'), code: `Authorization: Bearer ${MCP_KEY_PLACEHOLDER}` },
      },
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      icon: 'lucideMessageSquare',
      brand: 'chatgpt',
      steps: [
        t('mcp.guide.chatgpt1'),
        t('mcp.guide.chatgpt2'),
        t('mcp.guide.chatgpt3', { url }),
        t('mcp.guide.chatgpt4'),
      ],
      snippet: { title: t('mcp.serverUrl'), code: url },
      note: t('mcp.guide.chatgptNote'),
      key: {
        intro: t('mcp.guide.chatgptKey'),
        snippet: null,
      },
    },
    {
      id: 'cursor',
      name: 'Cursor',
      icon: 'lucideCode',
      brand: 'cursor',
      steps: [
        t('mcp.guide.cursor1'),
        t('mcp.guide.cursor2'),
        t('mcp.guide.cursor3'),
      ],
      snippet: { title: '~/.cursor/mcp.json', code: json({ mcpServers: { schuly: { url } } }) },
      installLink: { label: t('mcp.guide.installCursor'), href: cursorInstallLink(url) },
      key: {
        intro: t('mcp.guide.envKey'),
        snippet: {
          title: '~/.cursor/mcp.json',
          code: json({ mcpServers: { schuly: { url, headers: { Authorization: bearerEnv } } } }),
        },
      },
    },
    {
      id: 'vscode',
      name: 'VS Code',
      icon: 'lucideCode',
      brand: 'vscode',
      steps: [
        t('mcp.guide.vscode1'),
        t('mcp.guide.vscode2'),
        t('mcp.guide.vscode3'),
      ],
      snippet: {
        title: '.vscode/mcp.json',
        code: json({ servers: { schuly: { type: 'http', url } } }),
      },
      note: t('mcp.guide.vscodeNote'),
      installLink: { label: t('mcp.guide.installVscode'), href: vscodeInstallLink(url) },
      key: {
        intro: t('mcp.guide.vscodeKey'),
        snippet: {
          title: '.vscode/mcp.json',
          code: json({
            inputs: [
              {
                type: 'promptString',
                id: 'schuly_key',
                description: t('mcp.guide.keyDescription'),
                password: true,
              },
            ],
            servers: {
              schuly: {
                type: 'http',
                url,
                headers: { Authorization: 'Bearer ${input:schuly_key}' },
              },
            },
          }),
        },
      },
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      icon: 'lucideCode',
      brand: 'windsurf',
      steps: [
        t('mcp.guide.windsurf1'),
        t('mcp.guide.windsurf2'),
        t('mcp.guide.windsurf3'),
      ],
      snippet: {
        title: '~/.codeium/windsurf/mcp_config.json',
        code: json({ mcpServers: { schuly: { serverUrl: url } } }),
      },
      note: t('mcp.guide.windsurfNote'),
      key: {
        intro: t('mcp.guide.envKey'),
        snippet: {
          title: '~/.codeium/windsurf/mcp_config.json',
          code: json({
            mcpServers: { schuly: { serverUrl: url, headers: { Authorization: bearerEnv } } },
          }),
        },
      },
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      icon: 'lucideTerminal',
      brand: 'gemini',
      steps: [
        t('mcp.guide.gemini1'),
        t('mcp.guide.gemini2'),
        t('mcp.guide.finishBrowser'),
      ],
      snippet: { title: t('mcp.guide.terminal'), code: `gemini mcp add --transport http schuly ${url}` },
      note: `In ~/.gemini/settings.json use "httpUrl", not "url": { "mcpServers": { "schuly": { "httpUrl": "${url}" } } }`,
      key: {
        intro: t('mcp.guide.passHeader'),
        snippet: {
          title: t('mcp.guide.terminal'),
          code: `gemini mcp add --transport http --header "Authorization: Bearer ${MCP_KEY_PLACEHOLDER}" schuly ${url}`,
        },
      },
    },
    {
      id: 'codex-cli',
      name: 'Codex CLI',
      icon: 'lucideTerminal',
      brand: 'codex',
      steps: [
        t('mcp.guide.codex1'),
        t('mcp.guide.codex2'),
      ],
      snippet: {
        title: t('mcp.guide.terminal'),
        code: `codex mcp add schuly --url ${url}\ncodex mcp login schuly`,
      },
      note: `Or in ~/.codex/config.toml: [mcp_servers.schuly] with url = "${url}".`,
      key: {
        intro: t('mcp.guide.envRead'),
        snippet: {
          title: '~/.codex/config.toml',
          code: `[mcp_servers.schuly]\nurl = "${url}"\nbearer_token_env_var = "SCHULY_MCP_KEY"\n\n# then, in your shell:\nexport SCHULY_MCP_KEY=${MCP_KEY_PLACEHOLDER.replace('YOUR_KEY', '...')}`,
        },
      },
    },
  ];
}
