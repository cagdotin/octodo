import {
  invalidFrontmatter,
  newFrontmatter,
  readFrontmatter,
  readOrder,
  stringOrNull,
  type FrontmatterRead,
} from "../frontmatter.ts";

export interface ListFile {
  readonly name: string | null;
  readonly order: string;
  readonly body: string;
}

export const readListFile = (text: string): FrontmatterRead<ListFile> => {
  const read = readFrontmatter(text);
  if ("error" in read) return invalidFrontmatter(read.error);
  return {
    _tag: "Read",
    value: {
      name: stringOrNull(read.data["name"]),
      order: readOrder(read.data["order"]),
      body: read.body,
    },
  };
};

export const newListFile = (list: { readonly name: string; readonly order: string }): string =>
  newFrontmatter({ name: list.name, order: list.order });
