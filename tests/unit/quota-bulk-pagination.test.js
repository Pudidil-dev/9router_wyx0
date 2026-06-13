import { describe, expect, it, vi } from "vitest";
import { collectPaginatedConnections } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/pagination.js";

describe("quota bulk pagination", () => {
  it("collects accounts from every backend page", async () => {
    const fetchPage = vi.fn(async (page) => ({
      connections: Array.from(
        { length: page < 3 ? 500 : 200 },
        (_, index) => ({ id: `${page}-${index}` }),
      ),
      pagination: {
        page,
        pageSize: 500,
        total: 1200,
        totalPages: 3,
      },
    }));

    const result = await collectPaginatedConnections(fetchPage);

    expect(result.connections).toHaveLength(1200);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 1);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 3);
  });
});
