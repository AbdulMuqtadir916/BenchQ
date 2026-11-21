/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** A file under MPL-2.0 says so in its own header, as every file copied from ats-autofill-engine does. */
const MPL = /SPDX-License-Identifier:\s*MPL-2\.0/;
const SOURCE_FILE = /\.tsx?$/;
const TEST_FILE = /\.test\.tsx?$/;

export interface ShippedSource {
  /** From the root, with forward slashes: where the file goes under licenses/mpl-2.0-source/ in the package. */
  path: string;
  source: string;
}

/**
 * The source files under MPL-2.0 in `root` (the extension's src/), in path order. The bundle holds them compiled, so the
 * package also ships their source, as MPL-2.0 §3.2 asks: the build writes them to licenses/mpl-2.0-source/, which
 * public/licenses/THIRD-PARTY-NOTICES.txt points to. Tests are not shipped.
 */
export function mplSources(root: string): ShippedSource[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .map((file) => ({ path: relative(root, file).split(sep).join("/"), source: readFileSync(file, "utf8") }))
    .filter(({ source }) => MPL.test(source))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}
