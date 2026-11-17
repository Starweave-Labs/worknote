/** Project registry for one private data root. projects.json is authoritative when present. */
import { readFileSync, readdirSync, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

export interface ProjectConfig {
  slug: string;
  name: string;
  system?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
// These values are interpolated into Markdown headings and todo grouping syntax.
const STRUCTURE_RE = /[\u0000-\u001f\u007f\u2028\u2029#*_`\[\]{}<>|\\!·]|——/u;

function configError(message: string): Error {
  return new Error(`projects.json: ${message}`);
}

function label(value: unknown, field: string, position: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw configError(`第 ${position} 项 ${field} 必须是非空字符串`);
  }
  if (STRUCTURE_RE.test(value) || DANGEROUS_KEYS.has(value.trim().toLowerCase())) {
    throw configError(`第 ${position} 项 ${field} 不能含换行、Markdown 结构符、分组分隔符或保留名称`);
  }
  return value.trim();
}

/** Shared by runtime reads and the initialization CLI before writing a registry. */
export function validateProjectConfig(value: unknown): ProjectConfig[] {
  if (!Array.isArray(value)) throw configError("必须是项目数组，例如 [{\"slug\":\"example\",\"name\":\"示例项目\"}]");
  const slugs = new Set<string>();
  const names = new Set<string>();
  return value.map((item: unknown, index) => {
    const position = index + 1;
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      throw configError(`第 ${position} 项必须是项目对象`);
    }
    for (const key of Object.keys(item)) {
      if (DANGEROUS_KEYS.has(key)) throw configError(`第 ${position} 项含禁止的键 ${key}`);
      if (!["slug", "name", "system"].includes(key)) throw configError(`第 ${position} 项含未知字段 ${key}`);
    }
    const p = item as Record<string, unknown>;
    if (typeof p.slug !== "string" || !SLUG_RE.test(p.slug) || DANGEROUS_KEYS.has(p.slug)) {
      throw configError(`第 ${position} 项 slug 不合法；只能用小写字母、数字、下划线、连字符，以字母或数字开头，且不能使用保留键`);
    }
    // A validated literal slug is also a safe fallback label, including benign underscores.
    const name = p.name === p.slug ? p.slug : label(p.name, "name", position);
    const system = p.system === undefined ? undefined : label(p.system, "system", position);
    if (slugs.has(p.slug)) throw configError(`slug 重复：${p.slug}`);
    if (names.has(name)) throw configError(`项目名称重复：${name}`);
    slugs.add(p.slug);
    names.add(name);
    return { slug: p.slug, name, ...(system === undefined ? {} : { system }) };
  });
}

function header(file: string): { name?: string; system?: string; title?: string } {
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n").slice(0, 12);
  const out: { name?: string; system?: string; title?: string } = {};
  for (const line of lines) {
    let m = line.match(/^-\s*\*\*项目\*\*[：:]\s*(.+)$/);
    if (m) out.name = m[1].trim();
    m = line.match(/^-\s*\*\*系统\*\*[：:]\s*(.+)$/);
    if (m) out.system = m[1].trim();
    m = line.match(/^#\s+(.+)$/);
    if (m && !out.title) out.title = m[1].trim();
  }
  return out;
}

/** Discovery is only used for data roots without projects.json; it never follows project symlinks. */
function discoverProjects(root: string): ProjectConfig[] {
  const dir = join(root, "projects");
  if (!existsSync(dir)) return [];
  const projects: ProjectConfig[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    // Validate directory names before ever incorporating them into record paths.
    validateProjectConfig([{ slug, name: slug }]);
    const projectDir = join(dir, slug);
    const daily = join(projectDir, "daily");
    let name: string | undefined;
    let system: string | undefined;
    if (existsSync(daily) && lstatSync(daily).isDirectory()) {
      for (const month of readdirSync(daily).sort().reverse()) {
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const monthDir = join(daily, month);
        if (!lstatSync(monthDir).isDirectory()) continue;
        for (const date of readdirSync(monthDir).sort().reverse()) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          const dayDir = join(monthDir, date);
          if (!lstatSync(dayDir).isDirectory()) continue;
          const file = join(dayDir, `${date}.md`);
          if (!existsSync(file) || !lstatSync(file).isFile()) continue;
          const meta = header(file);
          name ||= meta.name;
          system ||= meta.system;
          if (name && system) break;
        }
        if (name && system) break;
      }
    }
    const modules = join(projectDir, "modules.md");
    if ((!name || !system) && existsSync(modules) && lstatSync(modules).isFile()) {
      const meta = header(modules);
      const titleName = meta.title
        ?.replace(/\s*[·—:-]?\s*模块(?:与验收)?清单\s*$/, "")
        .replace(/^模块(?:与验收)?清单\s*[·—:-]\s*/, "")
        .trim();
      name ||= meta.name || titleName || undefined;
      system ||= meta.system;
    }
    projects.push({ slug, name: name || slug, ...(system ? { system } : {}) });
  }
  return validateProjectConfig(projects);
}

/** Read fresh on every call so separate roots and runtime edits cannot share stale mappings. */
export function readProjectConfig(root: string): ProjectConfig[] {
  const file = join(root, "projects.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return discoverProjects(root);
    throw configError(`无法读取 ${file}：${error instanceof Error ? error.message : String(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw configError(`JSON 格式非法：${error instanceof Error ? error.message : String(error)}`);
  }
  return validateProjectConfig(value);
}

/** Root-specific slug-to-name map, with no inherited prototype properties. */
export function getProjectNames(root: string): Record<string, string> {
  const names: Record<string, string> = Object.create(null);
  for (const project of readProjectConfig(root)) names[project.slug] = project.name;
  return names;
}
