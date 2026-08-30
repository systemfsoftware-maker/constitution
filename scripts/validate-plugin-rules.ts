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

const EXPECTED_RULES: Record<string, true> = {
  "constitution-pure-core.md": true,
  "constitution-boundary.md": true,
  "constitution-verification.md": true,
  "constitution-conduct-review.md": true,
};

const VALID_SCOPE_RE = /^tool:(?:edit|write|ast_edit|read)\([^)]+\)$/;

function compileRuleCondition(pattern: string): RegExp {
  const match = INLINE_FLAG_PREFIX.exec(pattern);
  if (match) {
    if (!TRANSLATABLE_INLINE_FLAGS.test(match[1])) {
      throw new Error(`unsupported inline regex flag(s): '${match[1]}'`);
    }
    const flagRecord: Record<string, true> = {};
    for (const ch of match[1]) {
      flagRecord[ch] = true;
    }
    const flags = Object.keys(flagRecord).join("");
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

  for (const expected of Object.keys(EXPECTED_RULES)) {
    check(`required rule '${expected}' exists in rules/`, mdFiles.some((f) => f.name === expected));
  }
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
    const scopes = Array.isArray(fm.scope) ? fm.scope : (typeof fm.scope === "string" ? [fm.scope] : []);
    for (const s of scopes) {
      check(`${entry.name}: valid tool scope format '${s}'`, VALID_SCOPE_RE.test(s));
    }
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
