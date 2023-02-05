/* eslint-disable no-await-in-loop */
import { SMParser } from "./parser";
import glob from "glob";
import { CreateLogger } from "mei-logger";
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import type { SMResults } from "./types";

// Runs SM-File processing in batch and wires it into a Tachi Database Seeds instance.
// This should **not be used** unless you know **EXACTLY** what you are doing, and it is
// not really safe at all. Uses some extraordinarily strange shellhacks.

const logger = CreateLogger("SM Hash Dir Batch", undefined);

const songsFolder = process.argv[2];
const seedsFolder = process.argv[3];
const batchparse = process.argv[4];

if (!songsFolder) {
	logger.error(`Expected songs folder to search for .sm files in.`);
	process.exit(1);
}

if (!seedsFolder) {
	logger.error(`Expected Tachi database-seeds folder to wire output to.`);
	process.exit(1);
}

/**
 * Escapes a string for better interpolation into a bash script.
 * IT'S NOT SAFE
 * THIS FUNCTION IS NOT SAFE
 *
 * This is **obviously** not a good idea, and not safe at all.
 * Don't **ever** do this in your own scripts where you need security.
 */
function badEscapeFn(unsafe: string) {
	return `'${unsafe.replace(/'/gu, `\\'`)}'`;
}

async function main() {
	const directories = fs.readdirSync(songsFolder);

	const file = batchparse || "BATCHPARSE_TEMP.tmp";

	if (!batchparse) {
		fs.writeFileSync(
			file,
			`# Keep the packs you wish to parse here.
# start with e or y. edit the folder name if you wish.
${directories.map((e) => `y ${e}`).join("\n")}

# Save and exit the editor when you're done.`
		);

		try {
			const r = spawnSync(process.env.EDITOR ?? "nano", [file], {
				stdio: "inherit",
			});

			if (r.status !== 0) {
				throw new Error(`Editor exited with non-zero status code.`);
			}
		} catch (err) {
			logger.error(err);
			logger.error("Failed to open data in editor. Cancelling.");
			process.exit(1);
		}
	}

	const data = fs.readFileSync(file, "utf-8");

	// fs.rmSync(file);

	const promises = [];
	const commands: Array<Array<string>> = [];

	for (const line of data.split("\n").map((e) => e.trim())) {
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}

		// @ts-expect-error lazy
		const [_, type, dir] = /^(y|e)\s+(.*)$/u.exec(line) as [string, string, string];

		promises.push(
			(async () => {
				logger.info(`Parsing ${dir}.`);
				const packName = path.basename(dir);

				const files = glob.sync(`${songsFolder}/${dir}/**/*.sm`);

				const output: Array<SMResults> = [];

				let failed = 0;

				await Promise.all(
					files.map(async (file) => {
						const content = await readFile(file, "utf-8");

						const parser = new SMParser(file);

						try {
							const data = parser.parseSM(content);

							output.push(data);
						} catch (err) {
							failed++;
						}
					})
				);

				logger.info(`${files.length} parsed. ${failed} failed.`);

				const saveLoc = `/tmp/smtmp-${Buffer.from(packName).toString("base64")}.json`;

				await writeFile(saveLoc, JSON.stringify(output));

				const strs = [
					"ts-node",
					`scripts/rerunners/itg/parse-output.js`,
					`-p`,
					`${packName}`,
					`-i`,
					`${saveLoc}`,
				];

				if (type === "e") {
					strs.push("--ecsRule");
				}

				commands.push(strs);

				logger.info(`Added support for ${packName} to seeds.`);
			})()
		);
	}

	await Promise.allSettled(promises);

	// the seeds update bit needs to be done in lockstep.
	for (const command of commands) {
		logger.info(command);
		try {
			spawnSync(command[0], command.slice(1), { cwd: seedsFolder });
		} catch (err) {
			logger.error(err);
		}
	}
}

if (require.main === module) {
	void main();
}
