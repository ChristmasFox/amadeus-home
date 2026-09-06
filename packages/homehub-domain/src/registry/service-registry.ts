import type { ServiceDefinition, ServiceId, Action, RiskLevel } from '../schema/types.js';
import { ServiceDefinitionSchema } from '../schema/types.js';

/**
 * Git-tracked service inventory. runtime describes where the service lives;
 * executor describes the only command boundary allowed to inspect or mutate it.
 */
export class ServiceRegistry {
  private readonly services: Map<ServiceId, ServiceDefinition>;

  constructor() {
    this.services = new Map();
    this.initializeDefaultServices();
  }

  private initializeDefaultServices(): void {
    const defaultServices: ServiceDefinition[] = [
      {
        serviceId: 'langbot',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'LangBot',
        description: '主要机器人服务，处理所有平台消息路由',
        healthCheck: { type: 'docker', target: 'langbot', timeout: 15000, expected: 'up' },
        container: { name: 'langbot', composePath: '/var/lib/casaos/apps/langbot/docker-compose.yml' },
        // LangBot production uses its local SQLite data; Redis is optional.
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'medium',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'telegram-adapter',
        runtime: 'langbot-component',
        executor: 'langbot-component',
        displayName: 'Telegram Adapter',
        description: 'LangBot 内的 Telegram 平台组件，处理消息轮询和发送',
        healthCheck: { type: 'process', target: 'telegram', timeout: 10000, expected: 'up' },
        component: { name: 'telegram-adapter', containerName: 'langbot' },
        dependencies: ['langbot'],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'kook-adapter',
        runtime: 'langbot-component',
        executor: 'langbot-component',
        displayName: 'KOOK Adapter',
        description: 'LangBot 内的 KOOK 平台组件，处理消息轮询和发送',
        healthCheck: { type: 'process', target: 'kook', timeout: 10000, expected: 'up' },
        component: { name: 'kook-adapter', containerName: 'langbot' },
        dependencies: ['langbot'],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'mastra-pubg-runtime',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'Mastra/PUBG Runtime',
        description: 'PUBG 查询引擎运行时，端口 5310',
        healthCheck: { type: 'http', target: 'http://localhost:5310/healthz', timeout: 5000, expected: 'response' },
        container: { name: 'pubg-query-engine-v3', composePath: '/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'medium',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'n8n',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'n8n',
        description: '工作流自动化平台，端口 5679',
        healthCheck: { type: 'http', target: 'http://localhost:5679/healthz', timeout: 10000, expected: 'response' },
        container: { name: 'n8n', composePath: '/var/lib/casaos/apps/n8n/docker-compose.yml' },
        // n8n production uses its local SQLite database in CasaOS.
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'medium',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'postgres',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'PostgreSQL',
        description: '主要数据库服务',
        healthCheck: { type: 'tcp', target: 'localhost:5432', timeout: 5000, expected: 'response' },
        container: { name: 'postgres', composePath: '/var/lib/casaos/apps/postgres/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check'],
        riskLevel: 'high',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'redis',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'Redis',
        description: '缓存和消息队列',
        healthCheck: { type: 'tcp', target: 'localhost:6379', timeout: 3000, expected: 'response' },
        container: { name: 'redis', composePath: '/var/lib/casaos/apps/redis/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'emby',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'Emby',
        description: '媒体服务器',
        healthCheck: { type: 'http', target: 'http://localhost:8096/health', timeout: 10000, expected: 'response' },
        container: { name: 'emby', composePath: '/var/lib/casaos/apps/emby/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check', 'restart', 'organize_media'],
        riskLevel: 'medium',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'jellyfin',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'Jellyfin',
        description: '备用媒体服务器',
        healthCheck: { type: 'http', target: 'http://localhost:8096/health', timeout: 10000, expected: 'response' },
        container: { name: 'jellyfin', composePath: '/var/lib/casaos/apps/jellyfin/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'medium',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'qbittorrent',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'qBittorrent',
        description: 'BT 下载客户端',
        healthCheck: { type: 'http', target: 'http://localhost:8080', timeout: 10000, expected: 'response' },
        container: { name: 'qbittorrent', composePath: '/var/lib/casaos/apps/qbittorrent/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'aria2',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'aria2',
        description: '多协议下载工具',
        healthCheck: { type: 'http', target: 'http://localhost:6800/jsonrpc', timeout: 5000, expected: 'response' },
        container: { name: 'aria2', composePath: '/var/lib/casaos/apps/aria2/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'glances',
        runtime: 'docker',
        executor: 'docker',
        displayName: 'Glances',
        description: '系统监控工具',
        healthCheck: { type: 'http', target: 'http://localhost:61208', timeout: 5000, expected: 'response' },
        container: { name: 'glances', composePath: '/var/lib/casaos/apps/glances/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'cloudflared',
        runtime: 'macos',
        executor: 'macos-host',
        displayName: 'Cloudflare Tunnel',
        description: '运行于 macOS Host 的内网穿透隧道',
        healthCheck: { type: 'process', target: 'cloudflared', timeout: 10000, expected: 'up' },
        process: { name: 'cloudflared' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
    ];

    for (const service of defaultServices) {
      this.services.set(service.serviceId, ServiceDefinitionSchema.parse(service));
    }
  }

  getService(serviceId: ServiceId): ServiceDefinition | undefined {
    return this.services.get(serviceId);
  }

  getAllServices(): ServiceDefinition[] {
    return Array.from(this.services.values());
  }

  getServicesByRiskLevel(riskLevel: RiskLevel): ServiceDefinition[] {
    return this.getAllServices().filter((service) => service.riskLevel === riskLevel);
  }

  getServiceDependencies(serviceId: ServiceId): ServiceDefinition[] {
    const service = this.getService(serviceId);
    if (!service) return [];
    return service.dependencies
      .map((dependencyId) => this.getService(dependencyId))
      .filter((dependency): dependency is ServiceDefinition => dependency !== undefined);
  }

  registerService(service: ServiceDefinition): void {
    this.services.set(service.serviceId, ServiceDefinitionSchema.parse(service));
  }

  isActionAllowed(serviceId: ServiceId, action: Action): boolean {
    return this.getService(serviceId)?.allowedActions.includes(action) ?? false;
  }

  getServiceRiskLevel(serviceId: ServiceId): RiskLevel | undefined {
    return this.getService(serviceId)?.riskLevel;
  }
}
