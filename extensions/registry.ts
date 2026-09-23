export interface ToolRecord {
  name: string;
  description: string;
  parameters: unknown;
}

export interface CapabilityDescriptor {
  id: string;
  type: "tool";
  name: string;
  description: string;
  schemaChars: number;
}

export function schemaChars(tool: ToolRecord): number {
  return JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }).length;
}

/** Local-only index. None of these descriptors enter the tool description. */
export class CapabilityRegistry {
  private tools = new Map<string, CapabilityDescriptor>();

  refresh(tools: ToolRecord[]): void {
    this.tools.clear();
    for (const tool of tools) {
      if (tool.name === "capability" || tool.name === "tool_search") continue;
      this.tools.set(tool.name, {
        id: `tool:${tool.name}`,
        type: "tool",
        name: tool.name,
        description: tool.description ?? "",
        schemaChars: schemaChars(tool),
      });
    }
  }

  get(name: string): CapabilityDescriptor | undefined {
    return this.tools.get(name);
  }

  list(): CapabilityDescriptor[] {
    return [...this.tools.values()];
  }
}
