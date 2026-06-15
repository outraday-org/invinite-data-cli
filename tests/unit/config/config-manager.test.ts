import { describe, it, expect, afterEach } from 'vitest';
import { getBaseUrl, setBaseUrl, setStoredApiKey, getStoredApiKey, resetConfig, showConfig } from '../../../src/config/config-manager.js';

describe('config-manager', () => {
  afterEach(() => {
    resetConfig();
  });

  it('should have default base URL', () => {
    expect(getBaseUrl()).toBe('https://data.invinite.com');
  });

  it('should set and get base URL', () => {
    setBaseUrl('https://custom.api.com');
    expect(getBaseUrl()).toBe('https://custom.api.com');
  });

  it('should store and retrieve API key', () => {
    expect(getStoredApiKey()).toBeUndefined();
    setStoredApiKey('test-key-123');
    expect(getStoredApiKey()).toBe('test-key-123');
  });

  it('should reset config', () => {
    setBaseUrl('https://custom.api.com');
    setStoredApiKey('key');
    resetConfig();
    expect(getBaseUrl()).toBe('https://data.invinite.com');
    expect(getStoredApiKey()).toBeUndefined();
  });

  it('should show config summary', () => {
    const cfg = showConfig();
    expect(cfg).toHaveProperty('baseUrl');
    expect(cfg).toHaveProperty('apiKeySet');
  });
});
