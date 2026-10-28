import type { WorkspaceSnapshot } from "@octodo/contract";
import type { PluginDay } from "@octodo/contract/rules";
import { webSections, type SectionWeb } from "@octodo/plugins/web";

export type AnySection = SectionWeb<Readonly<Record<string, unknown>>>;

/** A section a workspace enables that the app can show, by its plugin id (decision 0027). */
export interface EnabledSection {
  readonly id: string;
  readonly web: AnySection;
}

/** The sections the workspace enables, in config.json's order: the rail's icons after Tasks. */
export const enabledSections = (snapshot: Pick<WorkspaceSnapshot, "plugins">) =>
  (snapshot.plugins ?? []).flatMap((id): Array<EnabledSection> => {
    const web = webSections[id];
    return web === undefined ? [] : [{ id, web }];
  });

/** The section with this id, while the workspace enables it. */
export const enabledSection = (snapshot: Pick<WorkspaceSnapshot, "plugins">, id: string) =>
  enabledSections(snapshot).find((section) => section.id === id);

/** The `day` of the section with this id, which Today and Next 7 days list its entries on. */
export const sectionDay = (section: string): PluginDay | undefined => webSections[section]?.day;
