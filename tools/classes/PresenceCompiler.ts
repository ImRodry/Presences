import { execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import actions from "@actions/core";
import chalk from "chalk";
import { config } from "dotenv";
import webpack from "webpack";

import { ErrorInfo } from "ts-loader/dist/interfaces";

import getFolderLetter from "../util/getFolderLetter.js";

const rootPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

if (!process.env.GITHUB_ACTIONS) config({ path: resolve(rootPath, ".env") });

export const tsconfig = JSON.stringify({
	extends: "../../../tsconfig.json",
});

export default class PresenceCompiler {
	cwd: string;

	constructor(
		public options?: {
			cwd?: string;
			webpack?: webpack.Configuration;
		}
	) {
		this.cwd = options?.cwd ?? rootPath;
	}

	getPresenceFolder(presence: string) {
		return resolve(this.cwd, "websites", getFolderLetter(presence), presence);
	}

	async compilePresence(
		presence: string | string[],
		options: {
			output?: string;
			transpileOnly?: boolean;
			emit?: boolean;
		} = {}
	) {
		options.emit ??= true;
		options.transpileOnly ??= false;

		const webpackConfig: webpack.Configuration = {
			mode: "production",
			devtool: "inline-source-map",
			resolve: {
				extensions: [".ts"],
			},

			output: options.emit
				? {
						iife: false,
						path: options.output,
						filename: "[name].js",
				  }
				: undefined,
			module: {
				rules: [
					{
						test: /\.ts$/,
						loader: "ts-loader",
						exclude: /node_modules/,
						options: {
							transpileOnly: options.transpileOnly,
							errorFormatter: (error: ErrorInfo) => {
								actions.error(chalk.redBright(error.content), {
									file: error.file,
									title: `TS ${error.code}`,
									startLine: error.line,
								});

								return chalk.cyan(
									basename(
										dirname(error.file) +
											"/" +
											basename(error.file) +
											":" +
											chalk.yellowBright(error.line) +
											":" +
											chalk.yellowBright(error.character) +
											" - " +
											chalk.redBright("Error ") +
											chalk.gray("TS" + error.code + ": ") +
											error.content
									)
								);
							},
						},
					},
				],
			},
			...this.options?.webpack,
		};

		if (Array.isArray(presence)) {
			let errors: webpack.WebpackError[] = [];

			actions.info(chalk.yellow(`Compiling ${presence.length} Presence(s)`));
			for (const p of presence) {
				const presencePath = this.getPresenceFolder(p);

				writeFileSync(resolve(presencePath, "tsconfig.json"), tsconfig);
				await this.installPresenceDependencies(p);

				const job = await new Promise<{
					error: Error | undefined;
					stats: webpack.Stats | undefined;
				}>(r =>
					webpack.webpack(
						{
							...webpackConfig,
							context: presencePath,
							output: options.emit
								? {
										iife: false,
										path: presencePath,
										filename: "[name].js",
								  }
								: undefined,
							entry: {
								presence: "./presence.ts",
								...(existsSync(resolve(presencePath, "iframe.ts")) && {
									iframe: "./iframe.ts",
								}),
							},
						},
						(error, stats) => r({ error, stats })
					)
				);

				if (job.error) throw job.error;

				errors.push(...(job.stats?.compilation?.errors || []));
			}

			for (const p of presence)
				if (existsSync(resolve(this.getPresenceFolder(p), "tsconfig.json")))
					rmSync(resolve(this.getPresenceFolder(p), "tsconfig.json"));

			errors = errors.filter(e => e.name !== "ModuleBuildError");

			if (!errors.length) {
				if (!options.transpileOnly)
					actions.info(
						chalk.green(`Successfully compiled ${presence.length} Presence(s)`)
					);
				else
					actions.info(
						chalk.green(
							`Successfully transpiled ${presence.length} Presence(s)`
						)
					);
			}

			return errors;
		}

		const presencePath = this.getPresenceFolder(presence);

		if (!options.output) options.output = presencePath;

		writeFileSync(resolve(presencePath, "tsconfig.json"), tsconfig);

		await this.installPresenceDependencies(presence);

		actions.info(chalk.yellow(`Compiling ${presence}...`));
		const job = await new Promise<{
			err: Error | undefined;
			stats: webpack.Stats | undefined;
		}>(r => {
			return webpack.webpack(
				{
					...webpackConfig,
					context: presencePath,
					entry: {
						presence: "./presence.ts",
						...(existsSync(resolve(presencePath, "iframe.ts"))
							? { iframe: "./iframe.ts" }
							: {}),
					},
				},
				(err, stats) => r({ err, stats })
			);
		});

		if (existsSync(resolve(presencePath, "tsconfig.json")))
			rmSync(resolve(presencePath, "tsconfig.json"));

		if (job.err) throw job.err;

		if (!job.stats?.compilation.errors.length) {
			if (!options.transpileOnly)
				actions.info(chalk.green(`Successfully compiled ${presence}`));
			else actions.info(chalk.green(`Successfully transpiled ${presence}`));
		}

		let errors = job.stats?.compilation.errors;

		errors = errors?.filter(e => e.name !== "ModuleBuildError");

		return errors || [];
	}

	async installPresenceDependencies(presence: string) {
		const folder = this.getPresenceFolder(presence);

		if (!existsSync(resolve(folder, "package.json"))) return;

		actions.info(chalk.blue(`Installing dependencies for ${basename(folder)}`));

		execSync("npm install --quiet --loglevel=error", {
			cwd: folder,
		});
	}
}

export interface Metadata {
	$schema: `https://schemas.premid.app/metadata/${number}.${number}`;
	author: Contributor;
	contributors?: Contributor[];
	service: string;
	altnames?: string[];
	description: { [lang: string]: string };
	url: `${string}.${string}` | `${string}.${string}`[];
	regExp?: string;
	version: `${number}.${number}.${number}`;
	logo: `https://i.imgur.com/${string}.${ImageTypes}`;
	thumbnail: `https://i.imgur.com/${string}.${ImageTypes}`;
	color: `#${string}`;
	tags: string | string[];
	category: string;
	iframe?: boolean;
	iFrameRegExp?: string;
	readLogs?: boolean;
	settings?:
		| Setting
		| MultiLanguageSetting
		| StringSetting
		| ValueSetting
		| ValuesSetting;
}

interface Contributor {
	name: string;
	id: `${bigint}`;
}

type ImageTypes = "png" | "jpeg" | "jpg" | "gif";

interface BaseSetting {
	id: string;
}

interface MultiLanguageSetting extends BaseSetting {
	multiLanguage: true | string | string[];
}

interface Setting extends BaseSetting {
	title: string;
	icon: string;
	if?: {
		[key: string]: Value;
	};
}

interface StringSetting extends Setting {
	value: string;
	placeholder: string;
}

interface ValueSetting extends Setting {
	value: boolean;
}

interface ValuesSetting extends Setting {
	value: number;
	values: Value[];
}

type Value = string | number | boolean;
