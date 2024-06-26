const { execSync } = require("child_process");
const { existsSync, readFileSync } = require("fs");
const { join } = require("path");

/**
 * Logs to the console
 */
const log = (msg) => console.log(`\n${msg}`); // eslint-disable-line no-console

/**
 * Exits the current process with an error code and message
 */
const exit = (msg) => {
	console.error(msg);
	process.exit(1);
};

/**
 * Executes the provided shell command and redirects stdout/stderr to the console
 */
const run = (cmd, cwd) => execSync(cmd, { encoding: "utf8", stdio: "inherit", cwd });

/**
 * Determines the current operating system (one of ["mac", "windows", "linux"])
 */
const getPlatform = () => {
	switch (process.platform) {
		case "darwin":
			return "mac";
		case "win32":
			return "windows";
		default:
			return "linux";
	}
};

/**
 * Returns the value for an environment variable (or `null` if it's not defined)
 */
const getEnv = (name) => process.env[name.toUpperCase()] || null;

/**
 * Sets the specified env variable if the value isn't empty
 */
const setEnv = (name, value) => {
	if (value) {
		process.env[name.toUpperCase()] = value.toString();
	}
};

/**
 * Returns the value for an input variable (or `null` if it's not defined). If the variable is
 * required and doesn't have a value, abort the action
 */
const getInput = (name, required) => {
	const value = getEnv(`INPUT_${name}`);
	if (required && !value) {
		exit(`"${name}" input variable is not defined`);
	}
	return value;
};

/**
 * Returns the default package manager to use based on the presence of `yarn.lock` or `pnpm-lock.yaml`
 * 
 * @returns {string} The default package manager to use
 * 
 * @example
 * const packageManager = getDefaultPackageManager();
 * console.log(`Will run ${packageManager} commands`);
 * 
 */
const getDefaultPackageManager = () => {
	if (existsSync(join(process.cwd(), "yarn.lock"))) {
		return "yarn";
	} else if (existsSync(join(process.cwd(), "pnpm-lock.yaml"))) {
		return "pnpm";
	} else {
		return "npm";
	}
}

/**
 * Installs NPM dependencies and builds/releases the Electron app
 */
const runAction = () => {
	const platform = getPlatform();
	const release = getInput("release", true) === "true";
	const pkgRoot = getInput("package_root", true);
	const buildScriptName = getInput("build_script_name", true);
	const skipBuild = getInput("skip_build") === "true";
	const skipInstall = getInput("skip_install") === "true";
	const useVueCli = getInput("use_vue_cli") === "true";
	const args = getInput("args") || "";
	const maxAttempts = Number(getInput("max_attempts") || "1");
	const packageManager = getInput("package_manager") || getDefaultPackageManager();

	// TODO: Deprecated option, remove in v2.0. `electron-builder` always requires a `package.json` in
	// the same directory as the Electron app, so the `package_root` option should be used instead
	const appRoot = getInput("app_root") || pkgRoot;

	const pkgJsonPath = join(pkgRoot, "package.json");
	// const pkgLockPath = join(pkgRoot, "package-lock.json");

	// Determine whether NPM should be used to run commands (instead of Yarn, which is the default)
	// const useNpm = existsSync(pkgLockPath);
	log(`Will run ${packageManager} commands in directory "${pkgRoot}"`);

	// Make sure `package.json` file exists
	if (!existsSync(pkgJsonPath)) {
		exit(`\`package.json\` file not found at path "${pkgJsonPath}"`);
	}

	// Copy "github_token" input variable to "GH_TOKEN" env variable (required by `electron-builder`)
	setEnv("GH_TOKEN", getInput("github_token", true));

	// Require code signing certificate and password if building for macOS. Export them to environment
	// variables (required by `electron-builder`)
	if (platform === "mac") {
		setEnv("CSC_LINK", getInput("mac_certs"));
		setEnv("CSC_KEY_PASSWORD", getInput("mac_certs_password"));
	} else if (platform === "windows") {
		setEnv("CSC_LINK", getInput("windows_certs"));
		setEnv("CSC_KEY_PASSWORD", getInput("windows_certs_password"));
	}

	// Disable console advertisements during install phase
	setEnv("ADBLOCK", true);

	if (skipInstall) {
		log("Skipping dependency installation because `skip_install` option is set");
	} else {
		log(`Installing dependencies using ${packageManager}`);
		// run(useNpm ? "npm install" : "yarn", pkgRoot);
		if (packageManager === "pnpm") {
			run(`pnpm install --frozen-lockfile`, pkgRoot);
		} else if (packageManager === "yarn") {
			run(`yarn install --frozen-lockfile`, pkgRoot);
		} else if (packageManager === "npm") {
			run(`npm install`, pkgRoot);
		} else {
			exit(`Unsupported package manager: ${packageManager}`);
		}
	}

	// Run NPM build script if it exists
	if (skipBuild) {
		log("Skipping build script because `skip_build` option is set");
	} else {
		log("Running the build script…");
		if (buildScriptName) {
			run(`${packageManager} run ${buildScriptName}`, pkgRoot);
		}
	}

	log(`Building${release ? " and releasing" : ""} the Electron app…`);
	const cmd = useVueCli ? "vue-cli-service electron:build" : "electron-builder";

	let buildCmd = ''
	if (packageManager === "pnpm") {
		buildCmd = `pnpm exec ${cmd}`
	} else if (packageManager === "yarn") {
		buildCmd = `yarn ${cmd}`
	} else if (packageManager === "npm") {
		buildCmd = `npx --no-install ${cmd}`
	}

	buildCmd += ` --${platform} ${release ? "--publish always" : ""} ${(platform == "mac") ? "--arm64 --x64" : ""} ${args}`



	for (let i = 0; i < maxAttempts; i += 1) {
		try {
			run(
				buildCmd,
				appRoot,
			);
			break;
		} catch (err) {
			if (i < maxAttempts - 1) {
				log(`Attempt ${i + 1} failed:`);
				log(err);
			} else {
				throw err;
			}
		}
	}
};

runAction();
