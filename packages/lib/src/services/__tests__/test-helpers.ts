import { vi } from "vitest";

export function createMockPool() {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
  } as any;
  return { mockPool, mockClient };
}

export function makeMockPool() {
  return {} as import("pg").Pool;
}
