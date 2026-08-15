import { encodeFunctionData, type Abi, type AbiFunction } from "viem";

import type { Address } from "./constants.js";
import { ProtocolError, ProtocolErrorCode } from "./errors.js";
import {
  GENERATED_DIAMOND_ABI,
  GENERATED_USDC_ABI,
} from "./generated/artifacts.js";
import type { DeploymentManifest, ManifestRuntime } from "./manifest.js";
import { assertProtocolBoundary, sha256Canonical } from "./manifest.js";

type FunctionItem<T extends readonly unknown[]> = Extract<T[number], { readonly type: "function" }>;
export type ProtocolDiamondFunctionName = FunctionItem<typeof GENERATED_DIAMOND_ABI>["name"];
export type ProtocolUsdcFunctionName = FunctionItem<typeof GENERATED_USDC_ABI>["name"];

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
  readonly value: 0n;
  readonly packageVersion: string;
  readonly protocolVersion: number;
}

export interface ProtocolCallFactory {
  diamond<TFunctionName extends ProtocolDiamondFunctionName, const TArgs extends readonly unknown[]>(
    functionName: TFunctionName,
    args: TArgs,
  ): PreparedProtocolCall<TFunctionName, TArgs>;
  usdc<TFunctionName extends ProtocolUsdcFunctionName, const TArgs extends readonly unknown[]>(
    functionName: TFunctionName,
    args: TArgs,
  ): PreparedProtocolCall<TFunctionName, TArgs>;
}

function validateCall(abi: Abi, functionName: string, args: readonly unknown[]): void {
  const matching = abi.filter(
    (item): item is AbiFunction => item.type === "function" && item.name === functionName,
  );
  if (matching.length !== 1 || matching[0]?.inputs.length !== args.length) {
    throw new ProtocolError(ProtocolErrorCode.VALIDATION_FAILED, `Unknown or ambiguous ABI call ${functionName}`);
  }
  try {
    encodeFunctionData({ abi, functionName, args } as never);
  } catch {
    throw new ProtocolError(ProtocolErrorCode.VALIDATION_FAILED, `Invalid arguments for ${functionName}`);
  }
}

export function createProtocolCallFactory(input: Readonly<{
  manifest: DeploymentManifest;
  diamondAbi: Abi;
  usdcAbi: Abi;
  runtime: ManifestRuntime;
}>): ProtocolCallFactory {
  const manifest = assertProtocolBoundary(input.manifest, input.diamondAbi, input.runtime);
  if (sha256Canonical(input.usdcAbi).toLowerCase() !== manifest.usdcAbiSha256.toLowerCase()) {
    throw new ProtocolError(ProtocolErrorCode.ABI_DIGEST_MISMATCH, "USDC ABI digest mismatch");
  }

  const prepare = <TFunctionName extends string, const TArgs extends readonly unknown[]>(
    contract: "diamond" | "usdc",
    address: Address,
    abi: Abi,
    functionName: TFunctionName,
    args: TArgs,
  ): PreparedProtocolCall<TFunctionName, TArgs> => {
    validateCall(abi, functionName, args);
    return Object.freeze({
      chainId: manifest.chainId,
      contract,
      address,
      abi,
      functionName,
      args: Object.freeze([...args]) as unknown as TArgs,
      value: 0n as const,
      packageVersion: manifest.packageVersion,
      protocolVersion: manifest.protocolVersion,
    });
  };

  return Object.freeze({
    diamond: <TFunctionName extends ProtocolDiamondFunctionName, const TArgs extends readonly unknown[]>(
      functionName: TFunctionName,
      args: TArgs,
    ) => prepare("diamond", manifest.diamond.address as Address, input.diamondAbi, functionName, args),
    usdc: <TFunctionName extends ProtocolUsdcFunctionName, const TArgs extends readonly unknown[]>(
      functionName: TFunctionName,
      args: TArgs,
    ) => prepare("usdc", manifest.usdc.address as Address, input.usdcAbi, functionName, args),
  });
}
