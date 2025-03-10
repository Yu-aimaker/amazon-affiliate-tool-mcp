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
import * as cheerio from 'cheerio';

interface AmazonLinkGeneratorArgs {
  url: string;
  tag?: string;
}

interface AmazonHtmlGeneratorArgs {
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

function isAmazonHtmlGeneratorArgs(obj: unknown): obj is AmazonHtmlGeneratorArgs {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as AmazonHtmlGeneratorArgs).url === 'string' &&
    (typeof (obj as AmazonHtmlGeneratorArgs).tag === 'string' ||
      typeof (obj as AmazonHtmlGeneratorArgs).tag === 'undefined')
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
        {
          name: 'generate_affiliate_html',
          description: 'Amazon商品URLから商品画像とアフィリエイトリンクを含むHTMLを生成します',
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
      try {
        if (request.params.name === 'generate_affiliate_link') {
          if (!isAmazonLinkGeneratorArgs(request.params.arguments)) {
            throw new McpError(ErrorCode.InvalidParams, '無効な引数形式です');
          }
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
        } else if (request.params.name === 'generate_affiliate_html') {
          if (!isAmazonHtmlGeneratorArgs(request.params.arguments)) {
            throw new McpError(ErrorCode.InvalidParams, '無効な引数形式です');
          }
          const html = await this.generateAffiliateHtml(
            request.params.arguments.url,
            request.params.arguments.tag
          );
          return {
            content: [
              {
                type: 'text',
                text: html,
              },
            ],
          };
        } else {
          throw new McpError(ErrorCode.MethodNotFound, `未知のツール: ${request.params.name}`);
        }
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

      const asinMatch = url.match(/\/([A-Z0-9]{10})(?:[/?]|$)/);
      if (!asinMatch) {
        throw new Error('有効なAmazon商品URLではありません');
      }
      const asin = asinMatch[1];

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

  private async getProductImage(url: string): Promise<string> {
    try {
      const response = await axios.get<string>(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      const $ = cheerio.load(response.data);
      const imageUrl = $('#landingImage').attr('src') || 
                      $('#imgBlkFront').attr('src') ||
                      $('#ebooksImgBlkFront').attr('src');

      if (!imageUrl) {
        throw new Error('商品画像が見つかりませんでした');
      }

      return imageUrl;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`画像取得エラー: ${error.message}`);
      }
      throw error;
    }
  }

  private async generateAffiliateHtml(url: string, tag?: string): Promise<string> {
    try {
      const affiliateUrl = await this.generateAffiliateLink(url, tag);
      const imageUrl = await this.getProductImage(url);

      return `<div style="display: flex; flex-direction: column; align-items: center; max-width: 300px; margin: 0 auto; font-family: Arial, sans-serif;">
  <a href="${affiliateUrl}" target="_blank" rel="nofollow" style="text-decoration: none; color: inherit; width: 100%; text-align: center;">
    <img src="${imageUrl}" alt="Amazon商品" style="max-width: 100%; height: auto; border-radius: 8px; margin-bottom: 12px;">
    <div style="display: flex; justify-content: center; width: 100%;">
      <div style="background: linear-gradient(45deg, #FFB347, #FFCC33); color: #000; padding: 12px 24px; border-radius: 25px; font-weight: bold; display: inline-flex; align-items: center; gap: 8px; transition: transform 0.2s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
        Amazonで購入する
      </div>
    </div>
  </a>
</div>`;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`HTML生成エラー: ${error.message}`);
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
