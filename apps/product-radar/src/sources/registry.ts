import { RadarError, UnsupportedCapabilityError } from '../core/errors.js';
import type { Listing } from '../core/listing/model.js';
import type { ImplementedWatchType, WatchTarget, WatchType } from '../core/watch/model.js';

export interface SourceCapabilities {
  sellerWatch: boolean;
  productWatch: boolean;
  searchWatch: boolean;
  categoryWatch: boolean;
  supportsPrice: boolean;
  supportsImages: boolean;
  supportsSeller: boolean;
  supportsProductStatus: boolean;
}

export interface ValidatedTarget extends WatchTarget {
  url: string;
  externalId: string;
}

export interface ListingSourceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: SourceCapabilities;
  validateTarget(type: WatchType, target: WatchTarget): Promise<ValidatedTarget>;
  fetchSellerListings(target: ValidatedTarget): Promise<unknown[]>;
  fetchProduct(target: ValidatedTarget): Promise<unknown>;
  normalizeListing(raw: unknown, context?: { target?: ValidatedTarget }): Listing;
  normalizeProductState(raw: unknown, context?: { target?: ValidatedTarget }): Listing;
}

export class SourceAdapterRegistry {
  private readonly adapters = new Map<string, ListingSourceAdapter>();

  register(adapter: ListingSourceAdapter): void {
    if (this.adapters.has(adapter.id)) throw new Error(`source adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }

  get(source: string): ListingSourceAdapter | undefined {
    return this.adapters.get(source.trim().toLowerCase());
  }

  require(source: string): ListingSourceAdapter {
    const adapter = this.get(source);
    if (!adapter) throw new RadarError(`unsupported source: ${source}`, 'UNSUPPORTED_SOURCE', 422, { source });
    return adapter;
  }

  supports(adapter: ListingSourceAdapter, type: WatchType): type is ImplementedWatchType {
    if (type === 'seller') return adapter.capabilities.sellerWatch;
    if (type === 'product') return adapter.capabilities.productWatch;
    return false;
  }

  requireCapability(adapter: ListingSourceAdapter, type: WatchType): asserts type is ImplementedWatchType {
    if (!this.supports(adapter, type)) throw new UnsupportedCapabilityError(adapter.id, type);
  }

  list(): ListingSourceAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  describe(adapter: ListingSourceAdapter): Record<string, unknown> {
    return {
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: adapter.capabilities,
      supportedWatchTypes: ['seller', 'product'].filter((type) => this.supports(adapter, type as WatchType)),
      unsupportedWatchTypes: ['search', 'category', 'smart'].filter((type) => !this.supports(adapter, type as WatchType)),
    };
  }
}
