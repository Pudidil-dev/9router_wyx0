export async function deleteConnectionsById(connectionIds, deleteConnection) {
  const deletedIds = [];
  const failedIds = [];

  for (const connectionId of connectionIds) {
    try {
      const response = await deleteConnection(connectionId);
      if (response?.ok) {
        deletedIds.push(connectionId);
      } else {
        failedIds.push(connectionId);
      }
    } catch {
      failedIds.push(connectionId);
    }
  }

  return { deletedIds, failedIds };
}
