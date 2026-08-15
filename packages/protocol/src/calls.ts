import type { Abi } from "viem";

import type { Address } from "./constants.js";
import type { DeploymentManifest, ManifestRuntime } from "./manifest.js";
import { assertManifestRuntime } from "./manifest.js";

export interface PreparedProtocolCall<
  TFunctionName extends string = string,
  TArgs extends readonly unknown[] = readonly unknown[],
> {
  readonly chainId: number;
  readonly contract: "diamond" | "usdc";
  readonly address: Address;
  readonly abi: Abi;
  readonly functionName: TFunctionName;
  readonly args: TArgs;
  readonly value: bigint;
  readonly protocolVersion: string;
}

export interface ProtocolCallFactory {
  diamond<TFunctionName extends string, const TArgs extends readonly unknown[]>(
    functionName: TFunctionName,
    args: TArgs,
  ): PreparedProtocolCall<TFunctionName, TArgs>;
  usdc<TFunctionName extends string, const TArgs extends readonly unknown[]>(
    functionName: TFunctionName,
    args: TArgs,
  ): PreparedProtocolCall<TFunctionName, TArgs>;
}

export function createProtocolCallFactory(input: Readonly<{
  manifest: DeploymentManifest;
  diamondAbi: Abi;
  usdcAbi: Abi;
  runtime: ManifestRuntime;
}>): ProtocolCallFactory {
  assertManifestRuntime(input.manifest, input.runtime);

  const prepare = <TFunctionName extends string, const TArgs extends readonly unknown[]>(
    contract: "diamond" | "usdc",
    address: Address,
    abi: Abi,
    functionName: TFunctionName,
    args: TArgs,
  ): PreparedProtocolCall<TFunctionName, TArgs> =>
    Object.freeze({
      chainId: input.manifest.chainId,
      contract,
      address,
      abi,
      functionName,
      args: Object.freeze([...args]) as unknown as TArgs,
      value: 0n,
      protocolVersion: input.manifest.protocolVersion,
    });

  return Object.freeze({
    diamond: <TFunctionName extends string, const TArgs extends readonly unknown[]>(
      functionName: TFunctionName,
      args: TArgs,
    ) => prepare("diamond", input.manifest.diamond.address as Address, input.diamondAbi, functionName, args),
    usdc: <TFunctionName extends string, const TArgs extends readonly unknown[]>(
      functionName: TFunctionName,
      args: TArgs,
    ) => prepare("usdc", input.manifest.usdc.address as Address, input.usdcAbi, functionName, args),
  });
}
