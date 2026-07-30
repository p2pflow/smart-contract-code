import { canonicalJson } from "../canonical/canonical-json";
import {
  MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS,
  SimulationReport,
  runSimulation,
} from "../simulator/simulator";
import {
  explicitUnapprovedSimulationConfig,
} from "../simulator/unapproved-fixture";

interface CliArguments {
  readonly orders: number;
  readonly seed: string;
}

export function simulationTargetsPass(
  targets: SimulationReport["targets"],
): boolean {
  return (
    targets.acceptedServiceCoveragePass &&
    targets.globalJainPass &&
    targets.comparableJainPass &&
    targets.globalMaxMinPass &&
    targets.zeroRegressionPass
  );
}

export async function runSimulationCli(
  argumentsValue: readonly string[],
): Promise<number> {
  const parsed = parseArguments(argumentsValue);
  const config = explicitUnapprovedSimulationConfig(
    parsed.orders,
    parsed.seed,
  );
  const report = await runSimulation(config);
  process.stdout.write(`${canonicalJson(report)}\n`);
  return simulationTargetsPass(report.targets) ? 0 : 2;
}

function parseArguments(argumentsValue: readonly string[]): CliArguments {
  let orders = MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS;
  let seed = "p2pflow-shadow-simulation-v2";
  for (let index = 0; index < argumentsValue.length; index += 1) {
    const argument = argumentsValue[index];
    if (argument === "--orders") {
      const value = argumentsValue[index + 1];
      if (value === undefined || !/^[0-9]+$/.test(value)) {
        throw new TypeError("--orders requires an integer");
      }
      orders = Number(value);
      index += 1;
      continue;
    }
    if (argument === "--seed") {
      const value = argumentsValue[index + 1];
      if (value === undefined || value.length === 0) {
        throw new TypeError("--seed requires a non-empty value");
      }
      seed = value;
      index += 1;
      continue;
    }
    throw new TypeError(`Unsupported simulation argument ${argument}`);
  }
  if (
    !Number.isSafeInteger(orders) ||
    orders < MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS
  ) {
    throw new RangeError(
      `--orders must be at least ${MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS}`,
    );
  }
  return { orders, seed };
}

if (require.main === module) {
  void runSimulationCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write("Offline shadow simulation failed\n");
      process.exitCode = 1;
    });
}
