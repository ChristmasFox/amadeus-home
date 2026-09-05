import type { ServiceDefinition, ServiceId, Action, RiskLevel } from '../schema/types.js';

export class ServiceRegistry {
  private services: Map<ServiceId, ServiceDefinition>;

  constructor() {
    this.services = new Map();
    this.initializeDefaultServices();
  }

  private initializeDefaultServices(): void {
    const defaultServices: ServiceDefinition[] = [
      {
        serviceId: 'langbot',
        displayName: 'LangBot',
        description: '主要机器人服务，处理所有平台消息路由',
        healthCheck: { type: 'docker', target: 'langbot', timeout: 15000, expected: 'up' },
        container: { name: 'langbot', composePath: '/var/lib/casaos/apps/langbot/docker-compose.yml' },
        dependencies: ['redis'],
        allowedActions: ['check', 'restart'],
        riskLevel: 'medium',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'telegram-adapter',
        displayName: 'Telegram Adapter',
        description: 'Telegram 平台适配器，处理消息轮询和发送',
        healthCheck: { type: 'docker', target: 'langbot', timeout: 10000, expected: 'up' },
        dependencies: ['langbot'],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'kook-adapter',
        displayName: 'KOOK Adapter',
        description: 'KOOK 平台适配器，处理消息轮询和发送',
        healthCheck: { type: 'docker', target: 'langbot', timeout: 10000, expected: 'up' },
        dependencies: ['langbot'],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'mastra-pubg-runtime',
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
        displayName: 'n8n',
        description: '工作流自动化平台，端口 5679',
        healthCheck: { type: 'http', target: 'http://localhost:5679/healthz', timeout: 10000, expected: 'response' },
        container: { name: 'n8n', composePath: '/var/lib/casaos/apps/n8n/docker-compose.yml' },
        dependencies: ['postgres'],
        allowedActions: ['check', 'restart'],
        riskLevel: 'medium',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'postgres',
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
        displayName: 'Emby',
        description: '媒体服务器',
        healthCheck: { type: 'http', target: 'http://localhost:8096/health', timeout: 10000, expected: 'response' },
        container: { name: 'emby', composePath: '/var/lib/casaos/apps/emby/docker-compose.yml' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'medium',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
      {
        serviceId: 'jellyfin',
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
        displayName: 'Cloudflare Tunnel',
        description: '内网穿透隧道',
        healthCheck: { type: 'process', target: 'cloudflared', timeout: 10000, expected: 'up' },
        dependencies: [],
        allowedActions: ['check', 'restart'],
        riskLevel: 'low',
        recovery: { restart: true, containerRecreate: false, clusterRestart: false },
      },
    ];

    for (const service of defaultServices) {
      this.services.set(service.serviceId, service);
    }
  }

  getService(serviceId: ServiceId): ServiceDefinition | undefined {
    return this.services.get(serviceId);
  }

  getAllServices(): ServiceDefinition[] {
    return Array.from(this.services.values());
  }

  getServicesByRiskLevel(riskLevel: RiskLevel): ServiceDefinition[] {
    return this.getAllServices().filter((s) => s.riskLevel === riskLevel);
  }

  getServiceDependencies(serviceId: ServiceId): ServiceDefinition[] {
    const service = this.getService(serviceId);
    if (!service) return [];
    const deps: ServiceDefinition[] = [];
    for (const depId of service.dependencies) {
      const dep = this.getService(depId);
      if (dep) deps.push(dep);
    }
    return deps;
  }

  registerService(service: ServiceDefinition): void {
    this.services.set(service.serviceId, service);
  }

  isActionAllowed(serviceId: ServiceId, action: Action): boolean {
    const service = this.getService(serviceId);
    if (!service) return false;
    return service.allowedActions.includes(action);
  }

  getServiceRiskLevel(serviceId: ServiceId): RiskLevel | undefined {
    return this.getService(serviceId)?.riskLevel;
  }
}
