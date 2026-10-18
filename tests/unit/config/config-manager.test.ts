import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl, setStoredApiKey, getStoredApiKey, resetConfig, showConfig } from '../../../src/config/config-manager.js';

describe('config-manager', () => {
  afterEach(() => {
    resetConfig();
  });

  it('should have default base URL', () => {
    expect(getBaseUrl()).toBe('https://api.data.invinite.com');
  });

  it('rewrites a persisted retired host once, on stderr', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setBaseUrl('https://data.invinite.com');
    expect(getBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(getBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith('Updated API host to https://api.data.invinite.com');
    stderr.mockRestore();
  });

  it('leaves a host the person set untouched', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setBaseUrl('http://localhost:4000');
    expect(getBaseUrl()).toBe('http://localhost:4000');
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
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
    expect(getBaseUrl()).toBe('https://api.data.invinite.com');
    expect(getStoredApiKey()).toBeUndefined();
  });

  it('should show config summary', () => {
    const cfg = showConfig();
    expect(cfg).toHaveProperty('baseUrl');
    expect(cfg).toHaveProperty('apiKeySet');
  });
});
