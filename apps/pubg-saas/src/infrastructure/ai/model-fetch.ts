import { Agent, fetch as undiciFetch } from 'undici';
import type { RequestInfo as UndiciRequestInfo, RequestInit as UndiciRequestInit } from 'undici';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export interface PublicModelFetchDependencies {
  dispatcher?: Agent;
  directFetch?: (input: FetchInput, init: FetchInit, dispatcher: Agent) => Promise<Response>;
  proxiedFetch?: typeof fetch;
}

function requestURL(input: FetchInput): URL | null {
  try {
    const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(value);
  } catch {
    return null;
  }
}

function directUndiciFetch(input: FetchInput, init: FetchInit, dispatcher: Agent): Promise<Response> {
  return undiciFetch(input as UndiciRequestInfo, {
    ...(init as UndiciRequestInit),
    dispatcher,
    redirect: 'error',
  }) as unknown as Promise<Response>;
}

/** Route only explicitly allowlisted model authorities around the public egress proxy. */
export function createPublicModelFetch(
  allowedInternalHosts: readonly string[],
  dependencies: PublicModelFetchDependencies = {},
): typeof fetch {
  const allowlist = new Set(allowedInternalHosts.map(host => host.toLowerCase()));
  const dispatcher = dependencies.dispatcher ?? (allowlist.size > 0 ? new Agent() : null);
  const directFetch = dependencies.directFetch ?? directUndiciFetch;
  const proxiedFetch = dependencies.proxiedFetch ?? globalThis.fetch.bind(globalThis);

  return (input, init) => {
    const url = requestURL(input);
    if (dispatcher && url && allowlist.has(url.host.toLowerCase()) && !url.username && !url.password) {
      return directFetch(input, { ...init, redirect: 'error' }, dispatcher);
    }
    return proxiedFetch(input, init);
  };
}
