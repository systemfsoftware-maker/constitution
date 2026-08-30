#!/usr/bin/env -S deno run --allow-read
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "@std/yaml";

interface RuleFrontmatter {
  description?: string;
  condition?: string | string[];
  scope?: string | string[];
  interruptMode?: string;
  [key: string]: unknown;
}

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RULES_DIR = path.join(ROOT_DIR, "plugins", "constitution", "rules");

let failed = false;
const INLINE_FLAG_PREFIX = /^\(\?([a-z]+)\)/;
const TRANSLATABLE_INLINE_FLAGS = /^[ims]+$/;

function compileRuleCondition(pattern: string): RegExp {
  const match = INLINE_FLAG_PREFIX.exec(pattern);
  if (match && TRANSLATABLE_INLINE_FLAGS.test(match[1])) {
    const flags = Array.from(new Set(match[1])).join("");
    return new RegExp(pattern.slice(match[0].length), flags);
  }
  return new RegExp(pattern);
}

function check(msg: string, ok: boolean) {
  if (!ok) {
    Deno.stderr.writeSync(new TextEncoder().encode(`FAIL: ${msg}\n`));
    failed = true;
  }
}

try {
  const entries = [...Deno.readDirSync(RULES_DIR)];
  const mdFiles = entries.filter((e) => e.isFile && e.name.endsWith(".md"));

  check("at least 4 rules defined", mdFiles.length >= 4);

  for (const entry of mdFiles) {
    const filePath = path.join(RULES_DIR, entry.name);
    const content = Deno.readTextFileSync(filePath);
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    check(`${entry.name}: contains YAML frontmatter`, match !== null);
    if (!match) continue;
    let fm: RuleFrontmatter;
    try {
      fm = parseYaml(match[1]) as RuleFrontmatter;
    } catch (e) {
      check(`${entry.name}: frontmatter is valid YAML (${e})`, false);
      continue;
    }

    check(`${entry.name}: description is non-empty`, typeof fm.description === "string" && fm.description.length > 0);
    check(`${entry.name}: condition is defined`, fm.condition !== undefined);
    check(`${entry.name}: scope is defined`, fm.scope !== undefined);
    check(`${entry.name}: interruptMode is tool-only or always`, fm.interruptMode === "tool-only" || fm.interruptMode === "always");

    const conditions = Array.isArray(fm.condition) ? fm.condition : (typeof fm.condition === "string" ? [fm.condition] : []);
    for (const pat of conditions) {
      try {
        compileRuleCondition(pat);
      } catch (err) {
        check(`${entry.name}: valid regex condition '${pat}' (${err})`, false);
      }
    }
  }
} catch (err) {
  console.error(`Error validating plugin rules: ${err}`);
  failed = true;
}

if (failed) {
  Deno.exit(1);
} else {
  console.log("valid: all plugin TTSR rules formatted correctly");
}
