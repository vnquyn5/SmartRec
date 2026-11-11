export function getPaginationPages(totalPages, currentPage) {
  const count = Math.max(0, Math.floor(Number(totalPages) || 0));
  if (count <= 7) return Array.from({ length: count }, (_, index) => index);

  const current = Math.min(Math.max(0, Math.floor(currentPage)), count - 1);
  const visible = new Set([0, count - 1, current - 1, current, current + 1]);
  if (current <= 2) {
    visible.add(1);
    visible.add(2);
  }
  if (current >= count - 3) {
    visible.add(count - 3);
    visible.add(count - 2);
  }
  const pages = [...visible]
    .filter((page) => page >= 0 && page < count)
    .sort((first, second) => first - second);
  const tokens = [];

  pages.forEach((page, index) => {
    if (index > 0) {
      const gap = page - pages[index - 1];
      if (gap === 2) tokens.push(pages[index - 1] + 1);
      else if (gap > 2) tokens.push(`ellipsis-${pages[index - 1]}-${page}`);
    }
    tokens.push(page);
  });

  return tokens;
}
