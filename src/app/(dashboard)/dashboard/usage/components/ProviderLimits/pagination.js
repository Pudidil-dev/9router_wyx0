export async function collectPaginatedConnections(fetchPage) {
  const firstPage = await fetchPage(1);
  const connections = [...(firstPage.connections || [])];
  const totalPages = firstPage.pagination?.totalPages || 1;

  if (totalPages > 1) {
    const remainingPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) => index + 2).map(
        fetchPage,
      ),
    );
    remainingPages.forEach((page) => {
      connections.push(...(page.connections || []));
    });
  }

  return { connections, firstPage };
}
