import { describe, expect, it, vi } from "vitest";
import { deleteConnectionsById } from "../../src/app/(dashboard)/dashboard/providers/[id]/connectionBulkActions.js";

describe("provider connection bulk actions", () => {
  it("deletes selected connections in order", async () => {
    const deleteConnection = vi.fn().mockResolvedValue({ ok: true });

    const result = await deleteConnectionsById(["connection-1", "connection-2"], deleteConnection);

    expect(deleteConnection.mock.calls).toEqual([["connection-1"], ["connection-2"]]);
    expect(result).toEqual({
      deletedIds: ["connection-1", "connection-2"],
      failedIds: [],
    });
  });

  it("reports failed responses and continues deleting the remaining selection", async () => {
    const deleteConnection = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ok: true });

    const result = await deleteConnectionsById(
      ["connection-1", "connection-2", "connection-3"],
      deleteConnection
    );

    expect(result).toEqual({
      deletedIds: ["connection-3"],
      failedIds: ["connection-1", "connection-2"],
    });
  });
});
