import type { GladlogApi } from '../../preload/api';

declare global {
  interface Window {
    __gladlogFixture?: GladlogApi;
  }
}

export function bridge(): GladlogApi {
  return window.__gladlogFixture ?? window.gladlog;
}
