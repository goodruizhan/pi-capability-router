import type { ToolRecord } from "./registry.ts";

export interface McpDescriptor {
  id: string;
  type: "mcp";
  name: string;
  description: string;
  toolName: string;
  keywords: string[];
}

/** The adapter owns MCP connections, auth, search and calls. We only activate its Pi tools. */
export class McpProvider {
  private tools = new Map<string, McpDescriptor>();

  refresh(tools: ToolRecord[]): void {
    this.tools.clear();
    for (const tool of tools) {
      const fromAdapter = /pi-mcp-adapter/i.test(`${tool.sourceInfo?.path ?? ""} ${tool.sourceInfo?.source ?? ""}`);
      if (!fromAdapter && tool.name !== "mcp") continue;
      this.tools.set(tool.name, {
        id: `mcp:${tool.name}`,
        type: "mcp",
        name: tool.name,
        description: tool.name === "mcp"
          ? "MCP gateway for external servers. Load it, then use mcp search to discover and call server tools."
          : tool.description ?? "MCP direct tool",
        toolName: tool.name,
        keywords: [],
      });
    }
  }

  list(): McpDescriptor[] { return [...this.tools.values()]; }
  get(name: string): McpDescriptor | undefined { return this.tools.get(name); }
}
