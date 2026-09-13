import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const aliases = new Map([
	["ml", pathToFileURL(join(root, "modules/data/ml/ml.js")).href],
	["mcp", pathToFileURL(join(root, "modules/network/mcp/mcp.js")).href],
	["iotdevice", pathToFileURL(join(root, "examples/network/mcp-iot/device.js")).href],
	["iotbridge", pathToFileURL(join(root, "examples/network/mcp-iot/bridge.js")).href]
]);

export function resolve(specifier, context, nextResolve) {
	const mapped = aliases.get(specifier);
	if (mapped)
		return { shortCircuit: true, url: mapped, format: "module" };
	return nextResolve(specifier, context);
}
