import { readFileSync } from "node:fs";

export interface PiSkill {
  name: string;
  description: string;
  filePath: string;
  sourceInfo?: { source?: string; path?: string };
  disableModelInvocation?: boolean;
}

export interface SkillDescriptor {
  id: string;
  type: "skill";
  name: string;
  description: string;
  path: string;
  source: string;
}

export class SkillProvider {
  private skills = new Map<string, SkillDescriptor>();
  readonly loaded = new Set<string>();
  loadedChars = 0;

  refresh(skills: PiSkill[]): void {
    this.skills.clear();
    for (const skill of skills) {
      if (!skill.name || !skill.filePath) continue;
      this.skills.set(skill.name, {
        id: `skill:${skill.name}`,
        type: "skill",
        name: skill.name,
        description: skill.description ?? "",
        path: skill.filePath,
        source: skill.sourceInfo?.source ?? "pi",
      });
    }
  }

  list(): SkillDescriptor[] { return [...this.skills.values()]; }
  get(name: string): SkillDescriptor | undefined { return this.skills.get(name); }
  reset(): void { this.loaded.clear(); this.loadedChars = 0; this.skills.clear(); }

  load(name: string, maxChars: number): { text: string; loaded: boolean } {
    const skill = this.skills.get(name);
    if (!skill) return { text: `Unknown skill: ${name}`, loaded: false };
    if (this.loaded.has(name)) return { text: `Skill already loaded: ${name}`, loaded: false };
    try {
      const body = readFileSync(skill.path, "utf8");
      const marker = `\n[Truncated; read ${skill.path} for remaining references if needed.]`;
      const excerpt = body.length > maxChars
        ? `${body.slice(0, Math.max(0, maxChars - marker.length))}${marker}`.slice(0, maxChars)
        : body;
      this.loaded.add(name);
      this.loadedChars += excerpt.length;
      return {
        text: `<loaded-skill name="${escapeAttr(name)}" source="${escapeAttr(skill.path)}">\n${excerpt}\n</loaded-skill>`,
        loaded: true,
      };
    } catch (error) {
      return { text: `Skill activation failed: ${name}: ${error instanceof Error ? error.message : String(error)}`, loaded: false };
    }
  }
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
