/** 语言无关的 finding 标记键:category|sorted(eventIds)。main(聚合)与
 * renderer(标记按钮)共用 —— 谓词单源。 */
export const findingKey = (f: {
  category: string;
  eventIds?: string[];
}): string => `${f.category}|${[...(f.eventIds ?? [])].sort().join(",")}`;
