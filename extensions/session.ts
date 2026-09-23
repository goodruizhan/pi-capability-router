import type { CapabilityDescriptor } from "./registry.ts";

export class CapabilitySession {
  readonly active = new Set<string>();
  activationCount = 0;
  startupActiveNames: string[] = [];
  startupRegisteredToolCount = 0;
  startupSchemaChars = 0;
  startupTotalSchemaChars = 0;

  reset(bootstrap: string[], capabilities: CapabilityDescriptor[], routerSchemaChars: number): void {
    this.active.clear();
    const known = new Set(capabilities.map((capability) => capability.name));
    for (const name of bootstrap) if (known.has(name)) this.active.add(name);
    this.activationCount = 0;
    this.startupActiveNames = [...this.active, "capability"];
    this.startupRegisteredToolCount = capabilities.length + 1;
    this.startupSchemaChars = capabilities
      .filter((capability) => this.active.has(capability.name))
      .reduce((sum, capability) => sum + capability.schemaChars, routerSchemaChars);
    this.startupTotalSchemaChars = capabilities.reduce(
      (sum, capability) => sum + capability.schemaChars,
      routerSchemaChars,
    );
  }

  load(names: string[], capabilities: CapabilityDescriptor[]): { enabled: string[]; already: string[]; unknown: string[] } {
    const known = new Set(capabilities.map((capability) => capability.name));
    const enabled: string[] = [];
    const already: string[] = [];
    const unknown: string[] = [];
    for (const name of [...new Set(names)]) {
      if (!known.has(name)) unknown.push(name);
      else if (this.active.has(name)) already.push(name);
      else {
        this.active.add(name);
        enabled.push(name);
      }
    }
    if (enabled.length) this.activationCount++;
    return { enabled, already, unknown };
  }

  stats(capabilities: CapabilityDescriptor[], routerSchemaChars: number) {
    const activeSchemaChars = capabilities
      .filter((capability) => this.active.has(capability.name))
      .reduce((sum, capability) => sum + capability.schemaChars, routerSchemaChars);
    const registeredToolSchemaChars = capabilities.reduce(
      (sum, capability) => sum + capability.schemaChars,
      routerSchemaChars,
    );
    return {
      startupActiveToolCount: this.startupActiveNames.length,
      startupToolSchemaChars: this.startupSchemaChars,
      startupRegisteredToolCount: this.startupRegisteredToolCount,
      startupRegisteredToolSchemaChars: this.startupTotalSchemaChars,
      estimatedAvoidedStartupChars: Math.max(0, this.startupTotalSchemaChars - this.startupSchemaChars),
      registeredToolCount: capabilities.length + 1,
      registeredToolSchemaChars,
      activeToolCount: this.active.size + 1,
      activeToolSchemaChars: activeSchemaChars,
      activatedToolCount: this.active.size - (this.startupActiveNames.length - 1),
      activationCount: this.activationCount,
    };
  }
}
