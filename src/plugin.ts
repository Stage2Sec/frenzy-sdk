import { Slack } from "./slack";

export interface PluginInfo {
    name: string,
    description: string,
    version: string
}
export type Plugin = (slack: Slack) => PluginInfo | Promise<PluginInfo>