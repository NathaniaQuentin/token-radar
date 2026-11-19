// Token Radar, main.ts: run the radar, then write the board, the dashboard and the dossier out.
//
// Usage: node main.ts [--input <snapshot.json>] [--output <dir>] [--dash <dashboard-dir>]
// [--screenshots <dir>] [--vendor <file>] [--license <file>] [--readme <file>]
// or: MAKEFUN_OUTPUT_DIR=<dir> node main.ts [--input <snapshot.json>]
//
// Input:  /input/snapshot.json by default, or --input <file>.
// Output: /output by default, or MAKEFUN_OUTPUT_DIR / --output <dir>.
//   /output/board.json     the board: 178 ranked rows, the whole watchlist covered.
//   /output/data.js        the dashboard's whole dataset, written beside the page, not inside it.
//   /output/dashboard/    the static page (index.html, app.css, app.js), copied whole.
//   /output/screenshots/  the 3 screenshots (board, detail, filtered), copied whole.
//   /output/dossier.json  the dossier the library writes over the whole output.
//   /output/LICENSE       the licence the repo carries, copied whole.
//   /output/README.md     the readme the repo carries, copied whole.
//
// Deterministic: no clock, no randomness, no platform paths in the bytes. Two runs of the same
// input write the same bytes. The program refuses to write a board the gate would refuse.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildRadar, boardIssue, dataScript, parseSnapshot, type RadarData } from './lib/model.ts';

/** The files the entry is allowed to carry into its output. */
const ALLOWED_ROOT = ['LICENSE', 'README.md', 'board.json', 'data.js', 'dossier.json'];
/** A dossier build fails on a name with two dots in a row; its checker is the authority, so the entry keeps it in sync. */
const BAD_FILE_NAME = /\.\.+/;

/** One of the program's own failures: the entry fails, and says why. */
class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

/** Whether a path exists. */
function exists(path: string): boolean {
  return existsSync(path);
}

/** Whether a path is a directory. */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a path is a regular file. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The files under `root`, as paths relative to it, in name order. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  if (!isDir(root)) return out;
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    if (isDir(path)) {
      for (const sub of listFiles(path)) out.push(`${name}/${sub}`);
    } else if (isFile(path)) out.push(name);
  }
  return out;
}

/** The byte count of the file, or null when it is not a file. */
function fileBytes(path: string): number | null {
  if (!isFile(path)) return null;
  return statSync(path).size;
}

/** The value of `--name <value>` or `--name=<value>` in the arguments, or null. */
function flagValue(args: string[], name: string): string | null {
  const long = `--${name}`;
  const idx = args.indexOf(long);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]!;
  const eq = args.find((a) => a.startsWith(`${long}=`));
  if (eq !== undefined) return eq.slice(long.length + 1);
  return null;
}

/** Whether `--name` appears among the arguments. */
function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** Whether a byte count is one of the sizes a screenshot may be. */
function screenshotBytes(bytes: number): boolean {
  return bytes > 0 && bytes <= 512 * 1024;
}

/** The name of a file as the output's root names it, for the dossier's listing. */
function rootName(path: string): string {
  return basename(path);
}

/** The program's entry point. */
function main(): void {
  const args = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  const input = flagValue(args, 'input') ?? '/input/snapshot.json';
  const output = flagValue(args, 'output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const dashboardDir = resolve(flagValue(args, 'dash') ?? join(here, 'dashboard'));
  const shotsDir = resolve(flagValue(args, 'screenshots') ?? join(here, 'screenshots'));
  const vendorDir = resolve(flagValue(args, 'vendor') ?? join(here, 'vendor'));
  const licenseFile = resolve(flagValue(args, 'license') ?? join(here, 'LICENSE'));
  const readmeFile = resolve(flagValue(args, 'readme') ?? join(here, 'README.md'));

  if (hasFlag(args, 'help')) {
    process.stdout.write(`Token Radar: node main.ts [--input <snapshot.json>] [--output <dir>]\n`);
    return;
  }

  // --- 1. The sealed snapshot ---------------------------------------------------------------
  if (!exists(input)) throw new CliError(`no snapshot at ${input}`);
  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));

  // --- 2. The board --------------------------------------------------------------------------
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new CliError(`the board fails its own checks: ${issue}`);

  // --- 3. The dashboard and the screenshots --------------------------------------------------
  if (!isDir(dashboardDir)) throw new CliError(`no dashboard at ${dashboardDir}`);
  const dashFiles = listFiles(dashboardDir);
  if (!dashFiles.includes('index.html')) throw new CliError('dashboard/index.html is missing');
  if (!dashFiles.some((f) => f.endsWith('.css'))) throw new CliError('the dashboard has no stylesheet');
  if (!dashFiles.some((f) => f.endsWith('.js'))) throw new CliError('the dashboard has no script');
  if (dashFiles.some((f) => BAD_FILE_NAME.test(f))) throw new CliError('a dashboard file name carries two dots in a row');
  if (dashFiles.some((f) => !/^[a-zA-Z0-9._-]+$/.test(basename(f)))) throw new CliError('a dashboard file name carries an illegal character');
  if (dashFiles.some((f) => f.startsWith('.') || f.startsWith('-'))) throw new CliError('a dashboard file name starts with a dot or a dash');
  const dashBytes = dashFiles.reduce((n, f) => n + (fileBytes(join(dashboardDir, f)) ?? 0), 0);
  if (dashBytes > 4 * 1024 * 1024) throw new CliError(`the dashboard is ${dashBytes} bytes, over the 4 MiB limit`);
  if (dashFiles.length > 400) throw new CliError(`the dashboard is ${dashFiles.length} files, over the 400-file limit`);

  if (!isDir(shotsDir)) throw new CliError(`no screenshots at ${shotsDir}`);
  const shotFiles = listFiles(shotsDir).filter((f) => !f.includes('/'));
  if (shotFiles.length < 3 || shotFiles.length > 4) throw new CliError(`screenshots: ${shotFiles.length} files, need 3 or 4`);
  for (const f of shotFiles) {
    const path = join(shotsDir, f);
    const bytes = fileBytes(path);
    if (bytes === null) throw new CliError(`screenshot ${f} is not a file`);
    if (!screenshotBytes(bytes)) throw new CliError(`screenshot ${f} is ${bytes} bytes, over the 512 KiB limit`);
    const head = readFileSync(path).subarray(0, 8);
    const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const jpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (!png && !jpg) throw new CliError(`screenshot ${f} is not a PNG or a JPEG`);
    if (BAD_FILE_NAME.test(f) || !/^[a-zA-Z0-9._-]+$/.test(f)) throw new CliError(`screenshot ${f} has an illegal name`);
  }

  // --- 4. The output -------------------------------------------------------------------------
  if (exists(output)) rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const boardJson = `${JSON.stringify({ rows: board }, null, 2)}\n`;
  writeFileSync(join(output, 'board.json'), boardJson, 'utf8');
  const boardBytes = Buffer.byteLength(boardJson);
  if (boardBytes > 8 * 1024 * 1024) throw new CliError(`board.json is ${boardBytes} bytes, over the 8 MiB limit`);
  if (board.length < 100 || board.length > 4000) throw new CliError(`the board has ${board.length} rows, need 100..4000`);

  const data = dataScript(radar);
  writeFileSync(join(output, 'data.js'), data, 'utf8');

  cpSync(dashboardDir, join(output, 'dashboard'), { recursive: true });
  cpSync(shotsDir, join(output, 'screenshots'), { recursive: true });
  if (exists(licenseFile)) cpSync(licenseFile, join(output, 'LICENSE'));
  if (exists(readmeFile)) cpSync(readmeFile, join(output, 'README.md'));

  // --- 5. The dossier ------------------------------------------------------------------------
  const dossier = buildDossier(output, { text_max_bytes: 65536 });
  writeFileSync(join(output, 'dossier.json'), dossier, 'utf8');
  const dossierBytes = Buffer.byteLength(dossier);
  if (dossierBytes > 1.5 * 1024 * 1024) throw new CliError(`dossier.json is ${dossierBytes} bytes, over the 1.5 MiB limit`);

  // --- 6. The report -------------------------------------------------------------------------
  const names = listFiles(output);
  const lines = [
    `Token Radar (radar-2) wrote ${names.length} files to ${output}`,
    `board.json: ${board.length} rows, watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length} covered, early rows ${radar.early_size}, live ${radar.live_size}`,
    `top: ${board[0]!.name} ($${board[0]!.implied_value_usd.toLocaleString('en-US')})`,
    `dossier.json: ${dossierBytes} bytes; board.json: ${boardBytes} bytes; dashboard: ${dashBytes} bytes in ${dashFiles.length} files`,
    `screenshots: ${shotFiles.map((f) => `${f} ${fileBytes(join(output, 'screenshots', f)) ?? 0} bytes`).join(', ')}`,
  ];
  for (const line of lines) process.stdout.write(`${line}\n`);
}

try {
  main();
} catch (err) {
  if (err instanceof CliError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
