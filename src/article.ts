// Bound both paragraph count and text volume; keep adjacent paragraphs together.
export function articleBatches<T extends { id: string; text: string }>(
  blocks: T[],
): T[][] {
  const groups: T[][] = [];
  let group: T[] = [],
    size = 0;
  for (const block of blocks) {
    if (
      group.length &&
      (group.length >= 40 || size + block.text.length > 12000)
    ) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(block);
    size += block.text.length;
  }
  if (group.length) groups.push(group);
  return groups;
}
