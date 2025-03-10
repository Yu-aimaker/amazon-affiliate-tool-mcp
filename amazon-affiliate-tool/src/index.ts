#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

interface AmazonLinkGeneratorArgs {
  url: string;
  tag?: string;
}

function isAmazonLinkGeneratorArgs(obj: unknown): obj is AmazonLinkGeneratorArgs {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as AmazonLinkGeneratorArgs).url === 'string' &&
    (typeof (obj as AmazonLinkGeneratorArgs).tag === 'string' ||
      typeof (obj as AmazonLinkGeneratorArgs).tag === 'undefined')
  );
}

class AmazonAffiliateTool {
  private server: Server;
  private defaultTag: string;

  constructor() {
    this.server = new Server(
      {
        name: 'amazon-affiliate-tool',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.defaultTag = process.env.AMAZON_AFFILIATE_TAG || '';
    
    this.setupToolHandlers();
    
    // エラーハンドリング
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'generate_affiliate_link',
          description: 'Amazon商品URLをアフィリエイトリンクに変換します',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'Amazon商品のURL',
              },
              tag: {
                type: 'string',
                description: 'アフィリエイトタグ（オプション）',
              },
            },
            required: ['url'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'generate_affiliate_link') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `未知のツール: ${request.params.name}`
        );
      }

      if (!isAmazonLinkGeneratorArgs(request.params.arguments)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          '無効な引数形式です'
        );
      }

      try {
        const affiliateUrl = await this.generateAffiliateLink(
          request.params.arguments.url,
          request.params.arguments.tag
        );
        return {
          content: [
            {
              type: 'text',
              text: affiliateUrl,
            },
          ],
        };
      } catch (error) {
        if (error instanceof Error) {
          return {
            content: [
              {
                type: 'text',
                text: `エラー: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    });

    // リソース一覧ハンドラー
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [],
    }));
  }

  private async generateAffiliateLink(url: string, tag?: string): Promise<string> {
    try {
      const affiliateTag = tag || this.defaultTag;
      if (!affiliateTag) {
        throw new Error('アフィリエイトタグが設定されていません');
      }

      // URLからASINを抽出
      const asinMatch = url.match(/\/([A-Z0-9]{10})(?:[/?]|$)/);
      if (!asinMatch) {
        throw new Error('有効なAmazon商品URLではありません');
      }
      const asin = asinMatch[1];

      // アフィリエイトリンクの生成
      const baseUrl = `https://www.amazon.co.jp/dp/${asin}`;
      const affiliateUrl = `${baseUrl}?tag=${affiliateTag}`;
      return affiliateUrl;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`リンク生成エラー: ${error.message}`);
      }
      throw error;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Amazon Affiliate Tool MCPサーバーが起動しました');
  }
}

const server = new AmazonAffiliateTool();
server.run().catch(console.error);
